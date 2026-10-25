/**
 * Cheque Manager's IPC channels (Cheque SRS v1.0 CHQ-PRT-05, CHQ-CAL-02; boards D02–D06): this computer's printers
 * and device id, print one cheque, print a calibration sheet or test leaf. Plain data, like channels.ts, so the
 * sandboxed preload can import it. The schemas and answers are in shared/cheque.ts; the handlers in
 * electron/services/cheque-print.ts.
 */
export const CHEQUE_INVOKE_CHANNELS = ['cheque:station', 'cheque:print', 'cheque:printQueued', 'cheque:printCalibration'] as const;
