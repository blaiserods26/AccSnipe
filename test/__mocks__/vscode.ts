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
  showWarningMessage: async () => {},
  showQuickPick: async () => undefined,
  showInputBox: async () => undefined
};

export const commands = {
  executeCommand: async () => {},
  getCommands: async () => []
};

export const env = {
  openExternal: async () => true
};

export const Uri = {
  parse: (str: string) => ({ toString: () => str })
};

export const authentication = {
  getSession: async (provider: string, scopes: string[], options: any) => ({
    id: 'mock-session-id',
    accessToken: 'mock-google-access-token',
    account: { id: 'mock-google-acc-id', label: 'mock.user@gmail.com' },
    scopes
  }),
  getAccounts: async () => []
};

export const workspace = {
  getConfiguration: () => ({
    get: (key: string, defaultVal: any) => defaultVal
  })
};
