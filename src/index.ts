import { EventEmitter } from 'events'
import InvalidFieldsError from './errors/InvalidFieldsError'
import DataHandlerAlreadyRegisteredError from './errors/DataHandlerAlreadyRegisteredError'
import MoneyHandlerAlreadyRegisteredError from './errors/MoneyHandlerAlreadyRegisteredError'
import * as IlpPacket from 'ilp-packet'
import { Writer } from 'oer-utils'

import {
  lpi1TransferToIlpPrepare,
  ilpFulfillToLpi1Fulfillment,
  lpi1FulfillmentToIlpFulfill,
  ilpRejectToLpi1Rejection,
  lpi1RejectionToIlpReject,
  ilpPrepareToLpi1Transfer
} from './converters'

import {
  base64url
} from './util'

import {
  TransferV1,
  RejectionReasonV1,
  MessageV1
} from './types'

const debug = require('debug')('ilp-compat-plugin')

export {
  InvalidFieldsError,
  DataHandlerAlreadyRegisteredError,
  MoneyHandlerAlreadyRegisteredError,

  TransferV1
}

export interface FunctionWithVersion extends Function {
  version?: number
}

export interface DataHandler {
  (data: Buffer): Promise<Buffer>
}

export interface MoneyHandler {
  (amount: string): Promise<void>
}

export interface PluginV2 extends EventEmitter {
  constructor: FunctionWithVersion
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  isConnected: () => boolean
  sendData: DataHandler
  sendMoney: MoneyHandler
  registerDataHandler: (handler: DataHandler) => void
  deregisterDataHandler: () => void
  registerMoneyHandler: (handler: MoneyHandler) => void
  deregisterMoneyHandler: () => void
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

const PEER_PROTOCOL_FULFILLMENT = Buffer.alloc(32)

export const COMPAT_SYMBOL = Symbol()

class Plugin extends EventEmitter {
  static readonly version = 2

  private oldPlugin: any
  private transfers: {
    [key: string]: {
      resolve: (result: Buffer) => void,
      reject: (err: Error) => void
    }
  }
  private _dataHandler?: DataHandler
  private _moneyHandler?: MoneyHandler

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
    this.oldPlugin.on('outgoing_reject', this._handleOutgoingReject.bind(this, 'reject'))
    this.oldPlugin.on('outgoing_cancel', this._handleOutgoingReject.bind(this, 'cancel'))
    this.oldPlugin.on('incoming_transfer', this._handleIncomingTransfer.bind(this))
    this.oldPlugin.on('incoming_prepare', this._handleIncomingPrepare.bind(this))
    this.oldPlugin.registerRequestHandler(this._handleRequest.bind(this))
  }

  static isV2Plugin (plugin: PluginV1 | PluginV2): plugin is PluginV2 {
    return plugin.constructor.version === 2
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

  async sendData (data: Buffer): Promise<Buffer> {
    if (!Buffer.isBuffer(data)) {
      throw new TypeError('sendData must be passed a buffer. typeof=' + typeof data)
    }

    if (data[0] === IlpPacket.Type.TYPE_ILP_PREPARE) {
      const ilpPrepare = IlpPacket.deserializeIlpPrepare(data)

      if (ilpPrepare.destination === 'peer.config') {
        return this._getIldcpResponse()
      }

      const lpi1Transfer = ilpPrepareToLpi1Transfer(ilpPrepare)

      lpi1Transfer.to = this._getTo(ilpPrepare.destination)
      lpi1Transfer.from = this.oldPlugin.getAccount(),
      lpi1Transfer.ledger = this.oldPlugin.getInfo().prefix

      return new Promise<Buffer>((resolve, reject) => {
        this.transfers[lpi1Transfer.id] = { resolve, reject }

        this.oldPlugin.sendTransfer(lpi1Transfer)
          .catch(reject)
      })
    } else {
      const responseMessage = await this.oldPlugin.sendRequest({
        from: this.oldPlugin.getAccount(),
        to: this._getTo(),
        ledger: this.oldPlugin.getInfo().prefix,
        ilp: base64url(data)
      })

      if (responseMessage.ilp) {
        return Buffer.from(responseMessage.ilp, 'base64')
      } else if (
        responseMessage.custom &&
        typeof responseMessage.custom === 'object' &&
        Object.keys(responseMessage.custom).length
      ) {
        // Convert old "custom" based requests (like CCPv1) into data
        return Buffer.from(JSON.stringify(responseMessage.custom))
      } else {
        debug('received empty response.')
        return Buffer.alloc(0)
      }
    }
  }

  async sendMoney (amount: string) {
    // TODO: We already send money when making ILP payments. But perhaps we
    //   should be smart enough to also send money (using optimistic mode) when
    //   the amount from sendMoney calls exceeds the amount from ILP payments.
    return
  }

  registerDataHandler (handler: DataHandler): void {
    if (this._dataHandler) {
      throw new DataHandlerAlreadyRegisteredError('data handler is already registered.')
    }

    if (typeof handler !== 'function') {
      throw new InvalidFieldsError('data handler must be a function.')
    }

    this._dataHandler = handler
  }

  deregisterDataHandler (): void {
    this._dataHandler = undefined
  }

  registerMoneyHandler (handler: MoneyHandler): void {
    if (this._moneyHandler) {
      throw new MoneyHandlerAlreadyRegisteredError('money handler is already registered.')
    }

    if (typeof handler !== 'function') {
      throw new InvalidFieldsError('money handler must be a function.')
    }

    this._moneyHandler = handler
  }

  deregisterMoneyHandler (): void {
    this._moneyHandler = undefined
  }

  protected _getTo (destination?: string): string {
    const prefix = this.oldPlugin.getInfo().prefix

    let to
    if (destination && destination.startsWith(prefix)) {
      // If the destination starts with the ledger prefix, we deliver to the
      // local account as identified by the first segment after the prefix
      to = prefix + destination.substring(prefix.length).split('.')[0]
    } else {
      // Otherwise, we deliver to the default connector
      to = this.oldPlugin.getInfo().connectors[0]
    }

    if (!to) {
      throw new Error('No valid destination: no connector and destination is not local. destination=' + destination + ' prefix=' + prefix)
    }

    return to
  }

  protected _handleOutgoingFulfill (transfer: TransferV1, fulfillment: string, ilp: string) {
    if (!this.transfers[transfer.id]) {
      debug('fulfillment for outgoing transfer ignored, unknown transfer id. transferId=%s', transfer.id)
      return
    }
    debug('outgoing transfer fulfilled. transferId=%s', transfer.id)

    const ilpFulfill = lpi1FulfillmentToIlpFulfill(fulfillment, ilp)

    const { resolve } = this.transfers[transfer.id]

    resolve(ilpFulfill)
  }

  protected _handleOutgoingReject (type: 'reject' | 'cancel', transfer: TransferV1, reason: RejectionReasonV1) {
    if (!this.transfers[transfer.id]) {
      debug('%sion for outgoing transfer ignored, unknown transfer id. transferId=%s', type, transfer.id)
      return
    }
    debug('outgoing transfer %sed. transferId=%s', type, transfer.id)

    const { resolve, reject } = this.transfers[transfer.id]

    try {
      const ilpReject = lpi1RejectionToIlpReject(reason)

      // ILP rejections are successful returns from a plugin perspective, i.e.
      // we sent data and we successfully got a response.
      resolve(ilpReject)
    } catch (err) {
      reject(err)
    }
  }

  protected _handleIncomingTransfer (lpi1Transfer: TransferV1) {
    debug('incoming optimistic transfer. transferId=%s amount=%s', lpi1Transfer.id, lpi1Transfer.amount)

    if (!this._moneyHandler) {
      debug(`no money handler, ignoring incoming optimistic transfer ${lpi1Transfer.id}`)
      return
    }

    Promise.resolve(this._moneyHandler(lpi1Transfer.amount))
      .catch(err => {
        const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : err
        debug(`could not process incoming money ${lpi1Transfer.id}: ${errInfo}`)
      })
  }

  protected _handleIncomingPrepare (lpi1Transfer: TransferV1) {
    debug('incoming prepared transfer. transferId=%s', lpi1Transfer.id)

    const ilpPrepare = lpi1TransferToIlpPrepare(lpi1Transfer)

    ;(async () => {
      if (!this._dataHandler) {
        debug(`no data handler, rejecting incoming transfer ${lpi1Transfer.id}`)
        // Reject incoming transfer due to lack of handler
        this.oldPlugin.rejectIncomingTransfer(lpi1Transfer.id, {
          code: 'T01',
          name: 'Ledger Unreachable',
          message: 'No data handler registered',
          triggered_by: this.oldPlugin.getAccount(),
          triggered_at: new Date(),
          forwarded_by: ''
        })
        return
      }

      const responsePacket = await this._dataHandler(ilpPrepare)

      if (responsePacket[0] === IlpPacket.Type.TYPE_ILP_FULFILL) {
        const { fulfillment, ilp } = ilpFulfillToLpi1Fulfillment(responsePacket)

        this.oldPlugin.fulfillCondition(lpi1Transfer.id, fulfillment, ilp)
      } else if (responsePacket[0] === IlpPacket.Type.TYPE_ILP_REJECT) {
        const reason = ilpRejectToLpi1Rejection(responsePacket)

        this.oldPlugin.rejectIncomingTransfer(lpi1Transfer.id, reason)
      } else {
        throw new Error('unknown ilp response packet.')
      }
    })()
      .catch(err => {
        const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : err
        debug(`could not process incoming transfer ${lpi1Transfer.id}: ${errInfo}`)

        this.oldPlugin.rejectIncomingTransfer(lpi1Transfer.id, {
          code: 'F00',
          name: 'Bad Request',
          message: err.message,
          triggered_by: '',
          triggered_at: new Date(),
          forwarded_by: ''
        })
      })
  }

  protected async _handleRequest (request: MessageV1) {
    if (!this._dataHandler) {
      debug(`no data handler, rejecting incoming request ${request.id}`)
      throw new Error('no handler.')
    }

    if (request.ilp) {
      return {
        to: request.from,
        from: request.to,
        ledger: request.ledger,
        ilp: base64url(await this._dataHandler(Buffer.from(request.ilp, 'base64')))
      }
    } else {
      throw new Error('cannot handle requests without ilp packet')
    }
  }

  protected _getIldcpResponse () {
    const info = this.oldPlugin.getInfo()
    const clientName = this.oldPlugin.getAccount()

    const writer = new Writer()
    writer.writeVarOctetString(Buffer.from(clientName, 'ascii'))
    writer.writeUInt8(info.currencyScale || 9)
    writer.writeVarOctetString(Buffer.from(info.currency || '', 'utf8'))
    const ildcpResponse = writer.getBuffer()

    return IlpPacket.serializeIlpFulfill({
      fulfillment: PEER_PROTOCOL_FULFILLMENT,
      data: ildcpResponse
    })
  }
}

export default function convert (oldPlugin: PluginV1 | PluginV2): PluginV2 {
  if (typeof oldPlugin !== 'object') {
    throw new TypeError('not a plugin: not an object')
  }

  if (Plugin.isV2Plugin(oldPlugin)) {
    return oldPlugin
  }

  if (typeof oldPlugin.sendTransfer !== 'function') {
    throw new TypeError('not a plugin: no sendTransfer method')
  }

  if (oldPlugin[COMPAT_SYMBOL]) {
    return oldPlugin[COMPAT_SYMBOL]
  }

  const instance = new Plugin(oldPlugin)

  oldPlugin[COMPAT_SYMBOL] = instance

  return instance
}

// Support both the Node.js and ES6 module exports
const es6Exports = exports
module.exports = convert
Object.assign(module.exports, es6Exports)
