import { ch, none, salonPaper } from './contract-kit';
import { z } from 'zod';
import { deskEventRef, deskRegisterInput, deskForgetInput, deskScanInput, deskSearchInput, deskQueueAction, deskWalkInInput, deskPrintSettingsPatch, deskPrintJobsInput, type DeskRegistration, type DeskStatus, type DeskScanOutcome, type DeskSearchHit, type DeskQueueItem, type DeskPrintSettings, type DeskPrintOutcome } from '../event-desk';
import { restaurantPairInput, restaurantUnpairInput, restaurantOutboxAdd, restaurantOutboxAction, restaurantPrintPatch, restaurantPrintTest, restaurantPrintText, type RestaurantPairing, type RestaurantStatus, type RestaurantCopy, type RestaurantOutboxItem, type RestaurantPrintSettings, type RestaurantPrintJobLog, type RestaurantPrintOutcome } from '../restaurant';
import type { SalonDeskPairing, SalonDeskInfo, SalonPrintSettings, SalonPrintOutcome, SalonSyncStatus, SalonCopy, SalonCopyClient, SalonOutboxItem } from '../types';

/** The front desks with their own printers — SalonMate, the restaurant and the event desk: spread into `contract` (shared/ipc/contract.ts; audit D-G13). */
export const desksContract = {

  'print:print': ch(z.object({ html: z.string().max(5_000_000), title: z.string().max(200), silent: z.boolean().optional(), deviceName: z.string().max(200).optional() }), { session: true, rate: 2 }),
  'print:printers': ch(none, { session: true }),
  'print:toPdf': ch(z.object({ html: z.string().max(5_000_000), title: z.string().max(200) }), { session: true, rate: 2 }),

  // SalonMate's front desk: the key it is paired with stays in the main process.
  'salon:deskPairing': ch(none, { session: true }),
  'salon:deskPair': ch(
    z.object({
      location_id: z.number().int().positive(),
      name: z.string().trim().min(1).max(80),
      pos_register_id: z.number().int().positive().nullable().optional(),
      warehouse_id: z.number().int().positive().nullable().optional(),
      receipt_template: z.string().regex(/^[a-z0-9_]{1,40}$/).nullable().optional(),
    }),
    { session: true, rate: 3, sensitive: true },
  ),
  'salon:deskForget': ch(none, { session: true, rate: 3, sensitive: true }),
  // Its receipts go to the desk's own printer without a dialog; the drawer opens through it (salon-print.ts).
  'salon:printSettings': ch(none, { session: true }),
  'salon:printSettingsSet': ch(
    z
      .object({
        receipt_printer: z.string().trim().min(1).max(200).nullable(),
        a4_printer: z.string().trim().min(1).max(200).nullable(),
        paper: salonPaper,
        copies: z.number().int().min(1).max(3),
        auto_print: z.boolean(),
        silent: z.boolean(),
        drawer: z.enum(['off', 'printer']),
        drawer_pin: z.union([z.literal(2), z.literal(5)]),
      })
      .partial(),
    { session: true, rate: 5 },
  ),
  'salon:printReceipt': ch(z.object({ visit_id: z.number().int().positive(), paper: salonPaper.optional() }), { session: true, rate: 3 }),
  'salon:printTest': ch(z.object({ paper: salonPaper.optional() }), { session: true, rate: 2 }),
  'salon:printPage': ch(z.object({ html: z.string().max(500_000), paper: salonPaper.optional() }), { session: true, rate: 2 }),
  'salon:openDrawer': ch(none, { session: true, rate: 1, sensitive: true }),
  // Offline: the day's copy the screens fall back to, and what the counter did while WorkSuite was out of reach (salon-sync.ts).
  'salon:syncStatus': ch(none, { session: true }),
  'salon:syncNow': ch(none, { session: true, rate: 2 }),
  'salon:copy': ch(none, { session: true }),
  'salon:copyClients': ch(z.object({ q: z.string().max(120), limit: z.number().int().min(1).max(100).optional(), id: z.number().int().positive().optional() }), { session: true, rate: 20 }),
  'salon:outbox': ch(none, { session: true }),
  'salon:outboxAdd': ch(
    z.object({
      kind: z.enum(['client.create', 'visit.book', 'visit.check_in', 'visit.checkout']),
      local_id: z.string().max(40).nullable().optional(),
      payload: z.record(z.string(), z.unknown()),
      label: z.string().trim().min(1).max(200),
      detail: z.string().max(300).nullable().optional(),
    }),
    { session: true, rate: 10 },
  ),
  'salon:outboxResolve': ch(
    z.union([
      z.object({ id: z.string().uuid(), action: z.enum(['drop', 'retry', 'take_next']) }),
      z.object({ id: z.string().uuid(), action: z.literal('time'), starts_at: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/) }),
      z.object({ id: z.string().uuid(), action: z.literal('client'), client_id: z.number().int().positive() }),
      z.object({ id: z.string().uuid(), action: z.literal('edit'), changes: z.record(z.string().max(40), z.union([z.string().max(2000), z.boolean(), z.null()])) }),
    ]),
    { session: true, rate: 5 },
  ),

  /*
   * WorkSuite Events' desk (shared/event-desk.ts, electron/services/event-desk.ts): this computer as a check-in
   * device. The key the server hands over when it is registered stays in the main process, which also matches
   * scans against the offline copy and keeps what was done offline for the server.
   */
  'eventdesk:list': ch(none, { session: true }),
  'eventdesk:status': ch(deskEventRef, { session: true, rate: 20 }),
  'eventdesk:register': ch(deskRegisterInput, { session: true, rate: 2, sensitive: true }),
  'eventdesk:rotateKey': ch(deskEventRef, { session: true, rate: 1, sensitive: true }),
  'eventdesk:forget': ch(deskForgetInput, { session: true, rate: 2, sensitive: true }),
  'eventdesk:sync': ch(deskEventRef, { session: true, rate: 2 }),
  'eventdesk:scan': ch(deskScanInput, { session: true, rate: 20 }),
  'eventdesk:search': ch(deskSearchInput, { session: true, rate: 30 }),
  'eventdesk:queue': ch(deskEventRef, { session: true, rate: 10 }),
  'eventdesk:queueResolve': ch(deskQueueAction, { session: true, rate: 10 }),
  'eventdesk:walkIn': ch(deskWalkInInput, { session: true, rate: 5 }),
  // Badges go to the desk's own printer, silently when it says so; the page is the server's (event-desk-print.ts).
  'eventdesk:printSettings': ch(none, { session: true }),
  'eventdesk:printSettingsSet': ch(deskPrintSettingsPatch, { session: true, rate: 5 }),
  'eventdesk:printJobs': ch(deskPrintJobsInput, { session: true, rate: 5 }),

  /*
   * Restaurant Manager (shared/restaurant.ts, electron/services/restaurant): this computer as a paired terminal.
   * The device key the server hands over at pairing stays in the main process, which also plays the offline
   * outbox back, beats, keeps the menu and floor copy, and runs the print agent for the printers plugged in here.
   */
  'restaurant:pairing': ch(none, { session: true }),
  'restaurant:pair': ch(restaurantPairInput, { session: true, rate: 2, sensitive: true }),
  'restaurant:unpair': ch(restaurantUnpairInput, { session: true, rate: 2, sensitive: true }),
  'restaurant:status': ch(none, { session: true, rate: 20 }),
  'restaurant:syncNow': ch(none, { session: true, rate: 2 }),
  'restaurant:copy': ch(none, { session: true, rate: 10 }),
  'restaurant:outbox': ch(none, { session: true, rate: 10 }),
  'restaurant:outboxAdd': ch(restaurantOutboxAdd, { session: true, rate: 20 }),
  'restaurant:outboxResolve': ch(restaurantOutboxAction, { session: true, rate: 10 }),
  'restaurant:printSettings': ch(none, { session: true }),
  'restaurant:printSettingsSet': ch(restaurantPrintPatch, { session: true, rate: 5 }),
  'restaurant:printJobs': ch(none, { session: true, rate: 10 }),
  'restaurant:printNow': ch(none, { session: true, rate: 2 }),
  'restaurant:printTest': ch(restaurantPrintTest, { session: true, rate: 2 }),
  'restaurant:printText': ch(restaurantPrintText, { session: true, rate: 3 }),
  'restaurant:openDrawer': ch(none, { session: true, rate: 1, sensitive: true }),
};

export interface DesksOutputs {
  'print:print': boolean;
  'print:printers': Array<{ name: string; displayName: string; isDefault: boolean }>;
  'print:toPdf': string | null;
  'salon:deskPairing': SalonDeskPairing | null;
  'salon:deskPair': { desk: SalonDeskInfo; message: string | null };
  'salon:deskForget': void;
  'salon:printSettings': SalonPrintSettings;
  'salon:printSettingsSet': SalonPrintSettings;
  'salon:printReceipt': SalonPrintOutcome;
  'salon:printTest': SalonPrintOutcome;
  'salon:printPage': SalonPrintOutcome;
  'salon:openDrawer': SalonPrintOutcome;
  'salon:syncStatus': SalonSyncStatus;
  'salon:syncNow': SalonSyncStatus;
  'salon:copy': SalonCopy | null;
  'salon:copyClients': SalonCopyClient[];
  'salon:outbox': SalonOutboxItem[];
  'salon:outboxAdd': SalonOutboxItem;
  'salon:outboxResolve': SalonOutboxItem[];
  'eventdesk:list': DeskRegistration[];
  'eventdesk:status': DeskStatus;
  'eventdesk:register': { registration: DeskRegistration; message: string; reregistered: boolean };
  'eventdesk:rotateKey': { message: string };
  'eventdesk:forget': number;
  'eventdesk:sync': DeskStatus;
  'eventdesk:scan': DeskScanOutcome;
  'eventdesk:search': DeskSearchHit[];
  'eventdesk:queue': DeskQueueItem[];
  'eventdesk:queueResolve': DeskQueueItem[];
  'eventdesk:walkIn': { provisional_number: string; message: string };
  'eventdesk:printSettings': DeskPrintSettings;
  'eventdesk:printSettingsSet': DeskPrintSettings;
  'eventdesk:printJobs': DeskPrintOutcome;
  'restaurant:pairing': RestaurantPairing | null;
  'restaurant:pair': { pairing: RestaurantPairing; message: string };
  'restaurant:unpair': { revoked: boolean; message: string | null; dropped: number };
  'restaurant:status': RestaurantStatus;
  'restaurant:syncNow': RestaurantStatus;
  'restaurant:copy': RestaurantCopy | null;
  'restaurant:outbox': RestaurantOutboxItem[];
  'restaurant:outboxAdd': RestaurantOutboxItem;
  'restaurant:outboxResolve': RestaurantOutboxItem[];
  'restaurant:printSettings': RestaurantPrintSettings;
  'restaurant:printSettingsSet': RestaurantPrintSettings;
  'restaurant:printJobs': RestaurantPrintJobLog[];
  'restaurant:printNow': number;
  'restaurant:printTest': RestaurantPrintOutcome;
  'restaurant:printText': RestaurantPrintOutcome;
  'restaurant:openDrawer': RestaurantPrintOutcome;
}
