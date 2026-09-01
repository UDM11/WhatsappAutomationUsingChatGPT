const EventEmitter = require('events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.maxLogs = 100;
    this.logs = [];
  }

  emitEvent(type, data) {
    const event = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      timestamp: new Date().toISOString(),
      type,
      data,
    };

    this.logs.unshift(event);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    this.emit('event', event);
    return event;
  }

  getRecentEvents(limit = 50) {
    return this.logs.slice(0, limit);
  }

  clear() {
    this.logs = [];
    this.emit('cleared');
  }
}

module.exports = new EventBus();
