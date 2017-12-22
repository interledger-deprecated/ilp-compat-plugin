import * as uuid from 'uuid'
import { EventEmitter } from 'events'
import * as debug from 'debug'
import { InterledgerRejectionError, TransferHandlerAlreadyRegisteredError, InvalidFieldsError } from './errors'
import * as IlpPacket from 'ilp-packet'
import {
  parseIlpRejection,
  serializeIlpRejection,
  base64url,
  RejectionReasonV1
} from './util'

export { 
  InterledgerRejectionError, 
  TransferHandlerAlreadyRegisteredError, 
  InvalidFieldsError 
} 

export interface TransferV2 {
  ilp: Buffer,
  amount: string,
  executionCondition: Buffer,
  expiresAt: string,
  custom?: Object
}

export interface TransferV1 {
  id: string,
  to?: string,
  from?: string,
  ledger?: string,
  ilp: string,
  executionCondition: string,
  expiresAt: string,
  amount: string,
  custom: Object
}

export interface MessageV1 {
  id: string,
  from?: string,
  to?: string,
  ledger?: string,
  ilp?: Buffer,
  custom?: Object
}

export interface TransferV2Handler {
  (transfer: TransferV2): any
}

export interface RequestV1Handler {
  (request: MessageV1): any
}

export interface FulfillmentInfo {
  fulfillment: Buffer,
  ilp: Buffer
}

export interface FunctionWithVersion extends Function {
  version?: number
}

export interface PluginV2 extends EventEmitter {
  constructor: FunctionWithVersion,
  connect: () => Promise<void>,
  disconnect: () => Promise<void>,
  isConnected: () => boolean,
  getInfo: () => Object,
  sendTransfer: (transfer: TransferV2) => Promise<FulfillmentInfo>
}

export interface PluginV1 extends EventEmitter {
  constructor: FunctionWithVersion,
  sendTransfer: (transfer: TransferV1) => Promise<void>
}

const PASSTHROUGH_EVENTS = [
  'connect',
  'disconnect',
  'error',
  'info_change'
]

export const COMPAT_SYMBOL = Symbol()

export default function convert (oldPlugin: PluginV1 | PluginV2): PluginV2 {
  if (typeof oldPlugin !== 'object') {
    throw new TypeError('not a plugin: not an object')
  }

  if (typeof oldPlugin.sendTransfer !== 'function') {
    throw new TypeError('not a plugin: no sendTransfer method')
  }

  if ((<PluginV2>oldPlugin).constructor.version === 2) {
    return (<PluginV2>oldPlugin)
  }

  if (oldPlugin[COMPAT_SYMBOL]) {
    return oldPlugin[COMPAT_SYMBOL]
  }

  const instance = new Plugin(oldPlugin)

  oldPlugin[COMPAT_SYMBOL] = instance

  return instance
}

class Plugin extends EventEmitter {
  static readonly version = 2

  private oldPlugin: any
  private transfers: Object
  private _transferHandler?: TransferV2Handler

  constructor (oldPlugin: any) {
    super()

    this.oldPlugin = oldPlugin

    this.transfers = {}

    const originalEmit = this.oldPlugin.emit
    this.oldPlugin.emit = (eventType: string, ...args: any[]) => {
      // Emit on both the original plugin and - for some event types - also
      // on the wrapper
      originalEmit.call(oldPlugin, eventType, ...args)

      if (PASSTHROUGH_EVENTS.indexOf(eventType) !== -1) {
        this.emit(eventType, ...args)
      }
    }

    this.oldPlugin.on('outgoing_fulfill', this._handleOutgoingFulfill.bind(this))
    this.oldPlugin.on('outgoing_reject', this._handleOutgoingReject.bind(this))
    this.oldPlugin.on('outgoing_cancel', this._handleOutgoingCancel.bind(this))
    this.oldPlugin.on('incoming_transfer', this._handleIncomingTransfer.bind(this))
    this.oldPlugin.on('incoming_prepare', this._handleIncomingPrepare.bind(this))
  }

  connect () {
    return this.oldPlugin.connect()
  }

  disconnect () {
    return this.oldPlugin.disconnect()
  }

  isConnected () {
    return this.oldPlugin.isConnected()
  }

  getInfo () {
    return this.oldPlugin.getInfo()
  }

  async sendTransfer (transfer: TransferV2): Promise<FulfillmentInfo> {
    if (typeof transfer.ilp === 'string') {
      throw new TypeError('ILP packet was passed as a string, should be Buffer')
    }

    const id = uuid()
    const prefix = this.getInfo().prefix

    const packet = IlpPacket.deserializeIlpPacket(transfer.ilp).data

    const destinationAccount = (<IlpPacket.IlpForwardedPayment>packet || <IlpPacket.IlpPayment>packet).account
    const to = (destinationAccount ? this._getTo(destinationAccount) : '')

    const lpi1Transfer = {
      id,
      from: this.oldPlugin.getAccount(),
      to,
      ledger: prefix,
      amount: transfer.amount,
      ilp: transfer.ilp.toString('base64'),
      executionCondition: base64url(transfer.executionCondition),
      expiresAt: transfer.expiresAt,
      custom: transfer.custom || {}
    }

    const fulfillmentPromise: Promise<FulfillmentInfo> = new Promise((resolve, reject) => {
      this.transfers[id] = { resolve, reject }

      this.oldPlugin.sendTransfer(lpi1Transfer)
        .catch(reject)
    })
    return fulfillmentPromise
  }

  registerTransferHandler (handler: TransferV2Handler): void {
    if (this._transferHandler) {
      throw new TransferHandlerAlreadyRegisteredError('requestHandler is already registered')
    }

    if (typeof handler !== 'function') {
      throw new InvalidFieldsError('requestHandler must be a function')
    }

    this._transferHandler = handler
  }

  deregisterTransferHandler (): void {
    this._transferHandler = undefined
  }

  /**
   * Send a request.
   *
   * This functionality is considered deprecated and will likely be removed.
   *
   * @param {Message} request Request message
   * @return {Promise<Message>} Response message
   */
  sendRequest (request: MessageV1): Promise<null> {
    const ledger = this.getInfo().prefix
    const to = this._getTo()

    return this.oldPlugin.sendRequest(Object.assign({
      ledger,
      from: this.oldPlugin.getAccount(),
      to
    }, request))
  }

  /**
   * Register a request handler.
   *
   * This functionality is considered deprecated and will likely be removed.
   *
   * @param {Function} handler Callback to invoke when a request is received.
   */
  registerRequestHandler (handler: RequestV1Handler): null {
    return this.oldPlugin.registerRequestHandler(handler)
  }

  /**
   * Deregister a request handler.
   *
   * This functionality is considered deprecated and will likely be removed.
   */
  deregisterRequestHandler (): null {
    return this.oldPlugin.deregisterRequestHandler()
  }

  /**
   * Get plugin account.
   *
   * This functionality is considered deprecated and will likely be removed.
   *
   * @return {string} ILP address of this plugin
   */
  getAccount (): string {
    return this.oldPlugin.getAccount()
  }

  protected _getTo (destination?: string): string {
    const prefix = this.getInfo().prefix

    let to
    if (destination && destination.startsWith(prefix)) {
      // If the destination starts with the ledger prefix, we deliver to the
      // local account as identified by the first segment after the prefix
      to = prefix + destination.substring(prefix.length).split('.')[0]
    } else {
      // Otherwise, we deliver to the default connector
      to = this.getInfo().connectors[0]
    }

    if (!to) {
      throw new Error('No valid destination: no connector and destination is not local. destination=' + destination + ' prefix=' + prefix)
    }

    return to
  }

  protected _handleOutgoingFulfill (transfer: TransferV1, fulfillment: string, ilp: string) {
    if (!this.transfers[transfer.id]) {
      debug(`fulfillment for transfer ${transfer.id} ignored, unknown transfer id`)
      return
    }
    debug(`fulfillment for transfer ${transfer.id}`)

    const { resolve } = this.transfers[transfer.id]

    resolve({
      fulfillment: Buffer.from(fulfillment || '', 'base64'),
      ilp: Buffer.from(ilp || '', 'base64')
    })
  }

  protected _handleOutgoingReject (transfer: TransferV1, reason: RejectionReasonV1) {
    if (!this.transfers[transfer.id]) {
      debug(`rejection for transfer ${transfer.id} ignored, unknown transfer id`)
      return
    }
    debug(`rejection for transfer ${transfer.id}`)

    const { reject } = this.transfers[transfer.id]

    reject(serializeIlpRejection(reason))
  }

  protected _handleOutgoingCancel (transfer: TransferV1, reason: RejectionReasonV1) {
    if (!this.transfers[transfer.id]) {
      debug(`cancellation for transfer ${transfer.id} ignored, unknown transfer id`)
      return
    }
    debug(`cancellation for transfer ${transfer.id}`)

    const { reject } = this.transfers[transfer.id]

    reject(serializeIlpRejection(reason))
  }

  protected _handleIncomingTransfer (lpi1Transfer: TransferV1) {
    // TODO Handle incoming optimistic transfers
    console.warn('ilp-compat-plugin: Optimistic transfers not yet implemented')
  }

  protected _handleIncomingPrepare (lpi1Transfer: TransferV1) {
    debug(`incoming prepared transfer ${lpi1Transfer.id}`)

    const transfer = {
      amount: lpi1Transfer.amount,
      ilp: Buffer.from(lpi1Transfer.ilp || '', 'base64'),
      executionCondition: Buffer.from(lpi1Transfer.executionCondition, 'base64'),
      expiresAt: lpi1Transfer.expiresAt,
      custom: lpi1Transfer.custom || {}
    }

    ;(async () => {
      if (!this._transferHandler) {
        debug(`no transfer handler, rejecting incoming transfer ${lpi1Transfer.id}`)
        // Reject incoming transfer due to lack of handler
        throw new InterledgerRejectionError(
          'No transfer handler registered',
          IlpPacket.serializeIlpRejection({
            code: 'T01', // Ledger Unreachable
            message: 'No transfer handler registered',
            triggeredBy: this.oldPlugin.getAccount(),
            data: Buffer.alloc(0)
          })
        )
      }

      const { fulfillment, ilp } = await this._transferHandler(transfer)

      this.oldPlugin.fulfillCondition(lpi1Transfer.id, base64url(fulfillment), ilp)
    })()
      .catch(err => {
        const errInfo = (typeof err === 'object' && err.stack) ? err.stack : err
        debug(`could not process incoming transfer ${lpi1Transfer.id}: ${errInfo}`)

        if (err.name === 'InterledgerRejectionError') {
          this.oldPlugin.rejectIncomingTransfer(lpi1Transfer.id, parseIlpRejection(err.ilpRejection))
        } else {
          this.oldPlugin.rejectIncomingTransfer(lpi1Transfer.id, {
            code: 'F00',
            name: 'Bad Request',
            message: err.message,
            triggered_by: '',
            triggered_at: new Date(),
            forwarded_by: ''
          })
        }
      })
  }
}

// Support both the Node.js and ES6 module exports
const es6Exports = exports
module.exports = convert
Object.assign(module.exports, es6Exports)
