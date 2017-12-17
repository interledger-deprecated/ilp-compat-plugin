'use strict'

const IlpPacket = require('ilp-packet')
const debug = require('debug')('ilp-compat-plugin:util')
const InterledgerRejectionError = require('./errors/InterledgerRejectionError')

const ERROR_NAMES = {
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

exports.parseIlpRejection = (packet) => {
  if (!packet) {
    throw new TypeError('No ILP rejection packet')
  }

  try {
    const decodedPacket = IlpPacket.deserializeIlpRejection(packet)

    const reason = {
      code: decodedPacket.code,
      name: ERROR_NAMES[decodedPacket.code],
      message: decodedPacket.message || '',
      triggered_by: decodedPacket.triggeredBy,
      forwarded_by: '',
      triggered_at: new Date(),
      additional_info: { message: decodedPacket.message || '', data: decodedPacket.data.toString('base64') }
    }

    return reason
  } catch (err) {
    debug('error parsing ILP error packet', err)
    throw new Error('Error while parsing ILP rejection packet')
  }
}

exports.serializeIlpRejection = (reason) => {
  let additionalInfo
  if (typeof reason.additional_info === 'string') {
    try {
      additionalInfo = JSON.parse(reason.additional_info)
    } catch (e) {
      additionalInfo = {}
    }
  } else if (typeof reason.additional_info === 'object' && reason.additional_info !== null) {
    additionalInfo = reason.additional_info
  } else {
    additionalInfo = {}
  }

  let data = Buffer.alloc(0)
  try {
    data = Buffer.from(additionalInfo.data, 'base64')
  } catch (err) {
  }

  const message = reason.message || additionalInfo.message || ''

  return new InterledgerRejectionError({
    message,
    ilpRejection: IlpPacket.serializeIlpRejection({
      code: reason.code,
      triggeredBy: reason.triggered_by || '',
      message,
      data
    })
  })
}

exports.base64url = (buffer) => {
  return Buffer.from(buffer, 'base64')
    .toString('base64')
    .replace(/=$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}
