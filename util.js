'use strict'

const IlpPacket = require('ilp-packet')
const debug = require('debug')('ilp-compat-plugin:util')

exports.parseIlpRejection = (packet) => {
  if (!packet) {
    throw new TypeError('No ILP rejection packet')
  }

  try {
    const decodedPacket = IlpPacket.deserializeIlpError(packet)
    const lastConnector = (decodedPacket.forwardedBy.length ? packet.forwardedBy[decodedPacket.forwardedBy.length - 1] : '')

    let additionalInfo
    try {
      additionalInfo = JSON.parse(decodedPacket.data)
    } catch (e) {
      debug('error data is not JSON (which is probably fine)')
      additionalInfo = {}
    }

    return {
      code: decodedPacket.code,
      name: decodedPacket.name,
      triggered_by: decodedPacket.triggeredBy,
      forwarded_by: lastConnector,
      triggered_at: decodedPacket.triggeredAt,
      additional_info: additionalInfo
    }
  } catch (err) {
    debug('error parsing ILP error packet: ' + (packet && packet.toString('base64')), err)
    throw new Error('Error while parsing ILP rejection packet')
  }
}

exports.serializeIlpRejection = (rejectionInfo) => {
  let forwardedBy
  if (Array.isArray(rejectionInfo.forwarded_by)) {
    forwardedBy = rejectionInfo.forwarded_by
  } else if (typeof rejectionInfo.forwarded_by === 'string') {
    forwardedBy = [rejectionInfo.forwarded_by]
  } else {
    forwardedBy = []
  }
  return IlpPacket.serializeIlpError({
    code: rejectionInfo.code,
    name: rejectionInfo.name,
    triggeredBy: rejectionInfo.triggered_by,
    forwardedBy,
    triggeredAt: rejectionInfo.triggered_at,
    data: rejectionInfo.additional_info ? JSON.stringify(rejectionInfo.additional_info) : ''
  })
}

exports.base64url = (buffer) => {
  return Buffer.from(buffer, 'base64')
    .toString('base64')
    .replace(/=$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}
