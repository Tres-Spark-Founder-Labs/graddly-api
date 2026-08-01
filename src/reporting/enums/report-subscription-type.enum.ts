/**
 * Which scheduled report a subscription is for.
 *
 * An enum with one member today. F1.4.1 AC5 asks only for the monthly levy ROI
 * report, but the table it keys is a general distribution list, and a boolean
 * column named `isLevyRoi` would have to be migrated away the first time a
 * second scheduled report appears.
 */
export enum ReportSubscriptionType {
  LEVY_ROI_MONTHLY = 'levy_roi_monthly',
}
