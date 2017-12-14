'use strict'

const BaseError = require('./BaseError')

class InterledgerRejectionError extends BaseError {
  constructor (opts) {
    const message = opts.message || 'Unknown error'
    super(message)

    this.ilpRejection = opts.ilpRejection
  }
}

module.exports = InterledgerRejectionError
