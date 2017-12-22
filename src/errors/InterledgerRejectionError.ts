import { BaseError } from './BaseError'

export class InterledgerRejectionError extends BaseError {
  public ilpRejection: Buffer

  constructor (message = 'Unknown Error', ilpRejection: Buffer) {
    super(message)
    Object.setPrototypeOf(this, InterledgerRejectionError)

    this.ilpRejection = ilpRejection
  }
}
