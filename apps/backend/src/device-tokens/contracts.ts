export type DeviceTokenPlatform = 'android';

export type DeviceTokenRecord = Readonly<{
  id: string;
  userId: string;
  deviceId: string;
  fcmToken: string;
  platform: DeviceTokenPlatform;
  updatedAt: Date;
  createdAt: Date;
}>;

export type DeviceTokenUpsertInput = Readonly<{
  userId: string;
  deviceId: string;
  fcmToken: string;
  platform: DeviceTokenPlatform;
}>;
