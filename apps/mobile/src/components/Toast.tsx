import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type Theme, useTheme } from '../theme';

type ToastProps = {
  visible: boolean;
  message: string;
  isError: boolean;
};

export const Toast: React.FC<ToastProps> = ({ visible, message, isError }) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (!visible) return null;

  return (
    <View style={styles.toastContainer} pointerEvents="none">
      <View style={[styles.toast, isError && styles.toastError]}>
        <Text style={styles.toastText}>{message}</Text>
      </View>
    </View>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    toastContainer: {
      position: 'absolute',
      bottom: 50,
      left: 0,
      right: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toast: {
      backgroundColor: '#333333',
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 24,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
      elevation: 5,
    },
    toastError: {
      backgroundColor: theme.colors.error,
    },
    toastText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '500',
    },
  });
