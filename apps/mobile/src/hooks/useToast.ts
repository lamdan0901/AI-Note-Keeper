import { useCallback, useEffect, useRef, useState } from 'react';

type ToastState = { show: boolean; message: string; isError: boolean };

type UseToastResult = {
  toast: ToastState;
  showToast: (message: string, isError: boolean) => void;
};

export const useToast = (): UseToastResult => {
  const [toast, setToast] = useState<ToastState>({
    show: false,
    message: '',
    isError: false,
  });
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const showToast = useCallback((message: string, isError: boolean) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ show: true, message, isError });
    toastTimeoutRef.current = setTimeout(() => {
      setToast((prev) => (prev.show ? { ...prev, show: false } : prev));
      toastTimeoutRef.current = null;
    }, 1000);
  }, []);

  return { toast, showToast };
};
