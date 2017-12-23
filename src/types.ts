export interface TransferV1 {
  id: string
  to?: string
  from?: string
  ledger?: string
  ilp: string
  executionCondition: string
  expiresAt: string
  amount: string
  custom: Object
}

export interface MessageV1 {
  id: string
  from?: string
  to?: string
  ledger?: string
  ilp?: string
  custom?: Object
}

export interface RejectionReasonV1 {
  code: string,
  name: string,
  message: string,
  triggered_by: string,
  triggered_at: Date,
  forwarded_by: string,
  additional_info?: Object | string
}
