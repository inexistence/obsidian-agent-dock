class ChatSaveCoordinator {
  constructor(save) {
    this.save = save;
    this.pendingState = null;
    this.running = null;
  }

  request(state) {
    if (!state) {
      return this.running || Promise.resolve();
    }
    this.pendingState = state;
    if (!this.running) {
      this.running = this.drain();
    }
    return this.running;
  }

  async flush(state = null) {
    if (state) {
      this.pendingState = state;
    }
    while (this.pendingState || this.running) {
      if (!this.running) {
        this.running = this.drain();
      }
      await this.running;
    }
  }

  async drain() {
    try {
      while (this.pendingState) {
        const state = this.pendingState;
        this.pendingState = null;
        await this.save(state);
      }
    } finally {
      this.running = null;
      if (this.pendingState) {
        this.running = this.drain();
      }
    }
  }
}

module.exports = {
  ChatSaveCoordinator
};
