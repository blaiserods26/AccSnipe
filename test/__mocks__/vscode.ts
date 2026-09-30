export class EventEmitter<T> {
  private listeners: ((e: T) => any)[] = [];
  event = (listener: (e: T) => any) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index > -1) this.listeners.splice(index, 1);
      }
    };
  };
  fire(data: T): void {
    this.listeners.forEach(fn => fn(data));
  }
}

export const window = {
  showInformationMessage: async () => {},
  showErrorMessage: async () => {},
  showWarningMessage: async () => {}
};

export const commands = {
  executeCommand: async () => {}
};

export const env = {
  openExternal: async () => true
};

export const Uri = {
  parse: (str: string) => ({ toString: () => str })
};
