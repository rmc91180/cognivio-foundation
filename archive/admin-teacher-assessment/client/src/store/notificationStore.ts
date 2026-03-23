import { create } from 'zustand';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  link?: string;
  metadata?: Record<string, any>;
}

interface NotificationState {
  // Notifications list
  notifications: Notification[];
  unreadCount: number;

  // Push notification permission
  pushPermission: NotificationPermission | null;

  // Actions
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
  clearAllNotifications: () => void;

  // Push notifications
  requestPushPermission: () => Promise<boolean>;
  showBrowserNotification: (title: string, options?: NotificationOptions) => void;

  // Utility
  getUnreadNotifications: () => Notification[];
}

// Generate unique ID
const generateId = () => `notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  pushPermission: typeof Notification !== 'undefined' ? Notification.permission : null,

  addNotification: (notification) => {
    const newNotification: Notification = {
      ...notification,
      id: generateId(),
      timestamp: new Date(),
      read: false,
    };

    set((state) => ({
      notifications: [newNotification, ...state.notifications].slice(0, 100), // Keep max 100
      unreadCount: state.unreadCount + 1,
    }));

    // Show browser notification if permitted
    const { pushPermission, showBrowserNotification } = get();
    if (pushPermission === 'granted') {
      showBrowserNotification(notification.title, {
        body: notification.message,
        icon: '/favicon.ico',
        tag: newNotification.id,
      });
    }
  },

  markAsRead: (id: string) => {
    set((state) => {
      const notification = state.notifications.find((n) => n.id === id);
      if (notification && !notification.read) {
        return {
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n
          ),
          unreadCount: Math.max(0, state.unreadCount - 1),
        };
      }
      return state;
    });
  },

  markAllAsRead: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },

  removeNotification: (id: string) => {
    set((state) => {
      const notification = state.notifications.find((n) => n.id === id);
      const wasUnread = notification && !notification.read;
      return {
        notifications: state.notifications.filter((n) => n.id !== id),
        unreadCount: wasUnread ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
      };
    });
  },

  clearAllNotifications: () => {
    set({ notifications: [], unreadCount: 0 });
  },

  requestPushPermission: async () => {
    if (typeof Notification === 'undefined') {
      console.warn('Browser notifications not supported');
      return false;
    }

    if (Notification.permission === 'granted') {
      set({ pushPermission: 'granted' });
      return true;
    }

    if (Notification.permission === 'denied') {
      set({ pushPermission: 'denied' });
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      set({ pushPermission: permission });
      return permission === 'granted';
    } catch (err) {
      console.error('Failed to request notification permission:', err);
      return false;
    }
  },

  showBrowserNotification: (title: string, options?: NotificationOptions) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return;
    }

    try {
      const notification = new Notification(title, options);

      // Auto-close after 5 seconds
      setTimeout(() => notification.close(), 5000);

      // Handle click
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (err) {
      console.error('Failed to show browser notification:', err);
    }
  },

  getUnreadNotifications: () => {
    return get().notifications.filter((n) => !n.read);
  },
}));

// Helper functions for creating typed notifications
export const createInfoNotification = (title: string, message: string, link?: string) => ({
  type: 'info' as const,
  title,
  message,
  link,
});

export const createSuccessNotification = (title: string, message: string, link?: string) => ({
  type: 'success' as const,
  title,
  message,
  link,
});

export const createWarningNotification = (title: string, message: string, link?: string) => ({
  type: 'warning' as const,
  title,
  message,
  link,
});

export const createErrorNotification = (title: string, message: string, link?: string) => ({
  type: 'error' as const,
  title,
  message,
  link,
});
