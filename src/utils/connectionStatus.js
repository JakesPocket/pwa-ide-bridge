/**
 * Connection Status Manager
 * Tracks both Socket.IO WebSocket and HTTP fetch connectivity
 */

class ConnectionStatusManager {
  constructor() {
    this.listeners = new Set();
    this.state = {
      socketConnected: false,
      httpAvailable: true,
      online: navigator.onLine,
      status: 'connecting', // 'connecting' | 'connected' | 'disconnected' | 'offline'
    };
    
    this.socketCheckInterval = null;
    this.lastSocketEvent = Date.now();
    
    // Listen to browser online/offline events
    window.addEventListener('online', () => this.handleOnlineStatusChange(true));
    window.addEventListener('offline', () => this.handleOnlineStatusChange(false));
  }

  handleOnlineStatusChange(isOnline) {
    this.state.online = isOnline;
    if (!isOnline) {
      this.updateStatus('offline');
    } else {
      // When coming back online, wait for actual connection
      this.updateStatus('connecting');
    }
  }

  setSocketStatus(connected) {
    const changed = this.state.socketConnected !== connected;
    this.state.socketConnected = connected;
    this.lastSocketEvent = Date.now();
    
    if (changed) {
      this.recalculateStatus();
    }
  }

  setHttpStatus(available) {
    const changed = this.state.httpAvailable !== available;
    this.state.httpAvailable = available;
    
    if (changed) {
      this.recalculateStatus();
    }
  }

  recalculateStatus() {
    if (!this.state.online) {
      this.updateStatus('offline');
      return;
    }

    // Consider connected if either socket is connected OR HTTP is available
    const hasConnection = this.state.socketConnected || this.state.httpAvailable;
    
    if (hasConnection) {
      this.updateStatus('connected');
    } else {
      this.updateStatus('disconnected');
    }
  }

  updateStatus(newStatus) {
    if (this.state.status !== newStatus) {
      this.state.status = newStatus;
      this.notifyListeners();
    }
  }

  getStatus() {
    return { ...this.state };
  }

  subscribe(callback) {
    this.listeners.add(callback);
    
    // Immediately invoke with current status
    callback(this.getStatus());
    
    return () => {
      this.listeners.delete(callback);
    };
  }

  notifyListeners() {
    const status = this.getStatus();
    this.listeners.forEach(callback => {
      try {
        callback(status);
      } catch (err) {
        console.error('Error in connection status listener:', err);
      }
    });
  }

  // Called when app first loads
  setInitialConnecting() {
    this.updateStatus('connecting');
  }

  // Called when initial connection succeeds
  setInitialConnected() {
    this.updateStatus('connected');
  }
}

// Singleton instance
export const connectionStatusManager = new ConnectionStatusManager();
