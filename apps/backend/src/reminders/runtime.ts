import type { ReminderSchedulerConfig } from '../config.js';
import { readReminderSchedulerConfig } from '../config.js';
import {
  createDeviceTokensRepository,
  type DeviceTokensRepository,
} from '../device-tokens/repositories/device-tokens-repository.js';
import { createFcmPushProvider } from '../jobs/push/fcm-provider.js';
import type { PushProvider } from '../jobs/push/contracts.js';
import { createPushDeliveryService } from '../jobs/push/push-delivery-service.js';
import type { NoteChangeEventsRepository } from '../notes/repositories/note-change-events-repository.js';
import { createReminderNotificationSender } from './notification-sender.js';
import type { ReminderNotificationSender } from './notification-sender.js';
import {
  createReminderDeliveriesRepository,
  type ReminderDeliveriesRepository,
} from './repositories/reminder-deliveries-repository.js';
import {
  createRemindersRepository,
  type RemindersRepository,
} from './repositories/reminders-repository.js';
import {
  createDisabledSchedulerProvider,
  createQstashClient,
  createQstashSchedulerProvider,
  type QstashClientLike,
  type SchedulerProvider,
} from './scheduler-provider.js';
import {
  createReminderSchedulerService,
  type ReminderSchedulerService,
} from './scheduler-service.js';
import {
  createScheduledTaskExecutor,
  type ScheduledTaskExecutor,
} from './scheduled-task-executor.js';
import { createRemindersService, type RemindersService } from './service.js';

export type QstashVerifierConfig = Readonly<{
  currentSigningKey: string;
  nextSigningKey: string;
  callbackUrl: string;
}>;

export type ReminderSchedulerRuntime = Readonly<{
  remindersRepository: RemindersRepository;
  deliveriesRepository: ReminderDeliveriesRepository;
  notificationSender: ReminderNotificationSender;
  schedulerProvider: SchedulerProvider;
  schedulerService: ReminderSchedulerService;
  scheduledTaskExecutor: ScheduledTaskExecutor;
  remindersService: RemindersService;
  schedulerCallbacksEnabled: boolean;
  qstashVerifierConfig: QstashVerifierConfig | null;
}>;

export const createReminderSchedulerCallbackUrl = (baseUrl: string): string => {
  return new URL('/internal/reminders/scheduled-task', baseUrl).toString();
};

export const createReminderSchedulerProvider = (
  input: Readonly<{
    schedulerConfig?: ReminderSchedulerConfig;
    qstashClient?: QstashClientLike;
    now?: () => Date;
  }> = {},
): SchedulerProvider => {
  const schedulerConfig = input.schedulerConfig ?? readReminderSchedulerConfig();

  if (schedulerConfig.REMINDER_SCHEDULER_PROVIDER === 'disabled') {
    return createDisabledSchedulerProvider();
  }

  const callbackBaseUrl = schedulerConfig.REMINDER_SCHEDULER_CALLBACK_BASE_URL;
  const token = schedulerConfig.QSTASH_TOKEN;
  if (!callbackBaseUrl || !token) {
    throw new Error('QStash scheduler requires callback base url and token');
  }

  return createQstashSchedulerProvider({
    client:
      input.qstashClient ??
      createQstashClient({
        token,
        baseUrl: schedulerConfig.QSTASH_URL,
      }),
    callbackUrl: createReminderSchedulerCallbackUrl(callbackBaseUrl),
    now: input.now,
  });
};

export const createReminderSchedulerRuntime = (
  input: Readonly<{
    remindersRepository?: RemindersRepository;
    deliveriesRepository?: ReminderDeliveriesRepository;
    noteChangeEventsRepository?: NoteChangeEventsRepository;
    deviceTokensRepository?: Pick<
      DeviceTokensRepository,
      'listByUserId' | 'listUserIdsWithTokens' | 'deleteByDeviceIdForUser'
    >;
    pushProvider?: PushProvider;
    schedulerProvider?: SchedulerProvider;
    schedulerService?: ReminderSchedulerService;
    scheduledTaskExecutor?: ScheduledTaskExecutor;
    remindersService?: RemindersService;
    schedulerConfig?: ReminderSchedulerConfig;
    qstashClient?: QstashClientLike;
    now?: () => Date;
  }> = {},
): ReminderSchedulerRuntime => {
  const schedulerConfig = input.schedulerConfig ?? readReminderSchedulerConfig();
  const remindersRepository = input.remindersRepository ?? createRemindersRepository();
  const deliveriesRepository =
    input.deliveriesRepository ?? createReminderDeliveriesRepository();
  const deviceTokensRepository =
    input.deviceTokensRepository ?? createDeviceTokensRepository();
  const pushProvider = input.pushProvider ?? createFcmPushProvider();
  const schedulerProvider =
    input.schedulerProvider ??
    createReminderSchedulerProvider({
      schedulerConfig,
      qstashClient: input.qstashClient,
      now: input.now,
    });
  const schedulerService =
    input.schedulerService ??
    createReminderSchedulerService({
      provider: schedulerProvider,
      remindersRepository,
      now: input.now,
    });
  const notificationSender = createReminderNotificationSender({
    deviceTokensRepository,
    pushDeliveryService: createPushDeliveryService({
      provider: pushProvider,
    }),
  });
  const scheduledTaskExecutor =
    input.scheduledTaskExecutor ??
    createScheduledTaskExecutor({
      remindersRepository,
      deliveriesRepository,
      notificationSender,
      schedulerService,
      now: input.now,
    });
  const remindersService =
    input.remindersService ??
    createRemindersService({
      remindersRepository,
      noteChangeEventsRepository: input.noteChangeEventsRepository,
      schedulerService,
      now: input.now,
    });
  const schedulerCallbacksEnabled = schedulerConfig.REMINDER_SCHEDULER_PROVIDER === 'qstash';
  const qstashVerifierConfig =
    schedulerCallbacksEnabled &&
    schedulerConfig.REMINDER_SCHEDULER_CALLBACK_BASE_URL &&
    schedulerConfig.QSTASH_CURRENT_SIGNING_KEY &&
    schedulerConfig.QSTASH_NEXT_SIGNING_KEY
      ? {
          currentSigningKey: schedulerConfig.QSTASH_CURRENT_SIGNING_KEY,
          nextSigningKey: schedulerConfig.QSTASH_NEXT_SIGNING_KEY,
          callbackUrl: createReminderSchedulerCallbackUrl(
            schedulerConfig.REMINDER_SCHEDULER_CALLBACK_BASE_URL,
          ),
        }
      : null;

  return {
    remindersRepository,
    deliveriesRepository,
    notificationSender,
    schedulerProvider,
    schedulerService,
    scheduledTaskExecutor,
    remindersService,
    schedulerCallbacksEnabled,
    qstashVerifierConfig,
  };
};
