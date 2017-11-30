'use strict'

const BaseError = require('./BaseError')

const CODE_NAMES = {
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

class InterledgerRejectionError extends BaseError {
  constructor (opts) {
    super(opts.message)

    this.code = opts.code || 'F00'
    this.name = opts.name || CODE_NAMES[this.code] || 'Unknown'
    this.message = opts.message || 'Unknown Error'
    this.triggeredBy = opts.triggeredBy || ''
    this.forwardedBy = opts.forwardedBy || []
    this.triggeredAt = opts.triggeredAt || new Date()
    this.data = opts.data || JSON.stringify({ message: this.message || '' })
  }
}

module.exports = InterledgerRejectionError
