'use strict'

const IlpPacket = require('ilp-packet')
const debug = require('debug')('ilp-compat-plugin:util')
const InterledgerRejectionError = require('./errors/InterledgerRejectionError')

exports.parseIlpPayment = (packet) => {
  try {
    return IlpPacket.deserializeIlpPayment(Buffer.from(packet, 'base64'))
  } catch (err) {
    debug('error parsing ILP packet: ' + packet)
    throw new InterledgerRejectionError({
      code: 'F01',
      message: 'source transfer has invalid ILP packet'
    })
  }
}

exports.parseIlpFulfillment = (packet) => {
  if (!packet) {
    return { data: '' }
  }

  try {
    return IlpPacket.deserializeIlpFulfillment(Buffer.from(packet, 'base64'))
  } catch (err) {
    // When parsing fulfillment data, we want to ignore errors, because we still
    // want to pass on the fulfillment no matter what.
    debug('error parsing ILP fulfillment data: ' + packet)
    return { data: '' }
  }
}

exports.serializeIlpFulfillment = ({ data }) => {
  return IlpPacket.serializeIlpFulfillment({ data: data.toString('base64') }).toString('base64')
}
