import uuid = require('uuid')

import {
  TransferV1,
  RejectionReasonV1
} from './types'

import * as IlpPacket from 'ilp-packet'

import {
  base64url
} from './util'

const debug = require('debug')('ilp-compat-plugin:converters')

export const ERROR_NAMES = {
  F00: 'Bad Request',
  F01: 'Invalid Packet',
  F02: 'Unreachable',
  F03: 'Invalid Amount',
  F04: 'Insufficient Destination Amount',
  F05: 'Wrong Condition',
  F06: 'Unexpected Payment',
  F07: 'Cannot Receive',
  F99: 'Application Error',
  T00: 'Internal Error',
  T01: 'Ledger Unreachable',
  T02: 'Ledger Busy',
  T03: 'Connector Busy',
  T04: 'Insufficient Liquidity',
  T05: 'Rate Limited',
  T99: 'Application Error',
  R00: 'Transfer Timed Out',
  R01: 'Insufficient Source Amount',
  R02: 'Insufficient Timeout',
  R99: 'Application Error'
}

export const lpi1TransferToIlpPrepare = (lpi1Transfer: TransferV1): Buffer => {
  if (!lpi1Transfer.ilp) {
    throw new TypeError('no packet attached to transfer.')
  }
  const deserializedPacket = IlpPacket.deserializeIlpPacket(Buffer.from(lpi1Transfer.ilp, 'base64'))

  if (deserializedPacket.type !== IlpPacket.Type.TYPE_ILP_PAYMENT && deserializedPacket.type !== IlpPacket.Type.TYPE_ILP_FORWARDED_PAYMENT) {
    throw new TypeError('invalid type of ilp packet: ' + deserializedPacket.type)
  }

  if (deserializedPacket.type === IlpPacket.Type.TYPE_ILP_PAYMENT) {
    debug('delivered payments are no longer supported, converting to forwarded payment.')
  }

  const { account, data } = deserializedPacket.data as IlpPacket.IlpForwardedPayment

  return IlpPacket.serializeIlpPrepare({
    amount: lpi1Transfer.amount,
    executionCondition: Buffer.from(lpi1Transfer.executionCondition, 'base64'),
    expiresAt: new Date(lpi1Transfer.expiresAt),
    destination: account,
    data
  })
}

export const ilpPrepareToLpi1Transfer = (ilpPrepare: IlpPacket.IlpPrepare): TransferV1 => {
  const id = uuid()

  const {
    amount,
    executionCondition,
    expiresAt,
    destination,
    data
  } = ilpPrepare

  const ilp = IlpPacket.serializeIlpForwardedPayment({
    account: destination,
    data
  })

  return {
    id,
    amount,
    ilp: base64url(ilp),
    executionCondition: base64url(executionCondition),
    expiresAt: expiresAt.toISOString(),
    custom: {}
  }
}

export const ilpFulfillToLpi1Fulfillment = (packet: Buffer): { fulfillment: string, ilp: string } => {
  const { fulfillment, data } = IlpPacket.deserializeIlpFulfill(packet)
  const ilp = IlpPacket.serializeIlpFulfillment({ data })
  return { fulfillment: base64url(fulfillment), ilp: base64url(ilp) }
}

export const lpi1FulfillmentToIlpFulfill = (fulfillment: string, ilp: string): Buffer => {
  const { data } = ilp
    ? IlpPacket.deserializeIlpFulfillment(Buffer.from(ilp, 'base64'))
    : { data: Buffer.alloc(0) }
  return IlpPacket.serializeIlpFulfill({
    fulfillment: Buffer.from(fulfillment, 'base64'),
    data
  })
}

export const ilpRejectToLpi1Rejection = (packet: Buffer): RejectionReasonV1 => {
  const {
    code,
    triggeredBy,
    message,
    data
  } = IlpPacket.deserializeIlpReject(packet)

  return {
    code,
    name: ERROR_NAMES[code],
    message,
    triggered_by: triggeredBy,
    triggered_at: new Date(),
    forwarded_by: '',
    additional_info: { data: base64url(data), message }
  }
}

interface AdditionalInfo {
  data?: string,
  message?: string
}

export const lpi1RejectionToIlpReject = (reason: RejectionReasonV1): Buffer => {
  const {
    code,
    message,
    triggered_by: triggeredBy,
    additional_info: additionalInfo
  } = reason

  let info: AdditionalInfo = {}
  if (typeof additionalInfo === 'string') {
    try {
      info = JSON.parse(additionalInfo)
    } catch (e) {
      // do nothing
    }
  } else if (typeof additionalInfo === 'object') {
    info = additionalInfo
  }

  let data = Buffer.alloc(0)
  if (info.data) {
    data = Buffer.from(info.data, 'base64')
  }

  return IlpPacket.serializeIlpReject({
    code,
    triggeredBy,
    message: message || info.message || '',
    data
  })
}
