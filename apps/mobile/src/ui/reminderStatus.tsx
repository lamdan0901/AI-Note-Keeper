/* eslint-disable react/prop-types */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { ReminderScheduleStatus } from "../../../../packages/shared/types/reminder";

type ReminderStatusProps = {
  status: ReminderScheduleStatus;
  lastError?: string | null;
  showRemediation?: boolean;
};

type StatusConfig = {
  label: string;
  summary: string;
  remediation?: string;
  color: string;
  background: string;
};

const STATUS_CONFIG: Record<ReminderScheduleStatus, StatusConfig> = {
  scheduled: {
    label: "Scheduled",
    summary: "This reminder is scheduled on your device.",
    color: "#0b5d1e",
    background: "#dff6e6",
  },
  unscheduled: {
    label: "Not scheduled",
    summary: "This reminder is not scheduled on your device.",
    remediation:
      "Open the app while online to resync. Ensure notifications and exact alarms are enabled.",
    color: "#7a3a00",
    background: "#ffe9d6",
  },
  error: {
    label: "Scheduling error",
    summary: "We could not schedule this reminder.",
    remediation:
      "Check notification permission and exact alarm settings, then open the app to reschedule.",
    color: "#7a0000",
    background: "#ffe0e0",
  },
};

export const ReminderStatus = ({
  status,
  lastError,
  showRemediation = true,
}: ReminderStatusProps): JSX.Element => {
  const config = STATUS_CONFIG[status];
  return (
    <View style={styles.container}>
      <View style={[styles.badge, { backgroundColor: config.background }]}>
        <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
      </View>
      <Text style={styles.summary}>{config.summary}</Text>
      {showRemediation && config.remediation ? (
        <Text style={styles.remediation}>{config.remediation}</Text>
      ) : null}
      {lastError ? <Text style={styles.errorDetail}>Details: {lastError}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#f5f6f8",
    gap: 6,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  summary: {
    fontSize: 14,
    color: "#1c1c1e",
  },
  remediation: {
    fontSize: 13,
    color: "#3a3a3c",
  },
  errorDetail: {
    fontSize: 12,
    color: "#6b0000",
  },
});
