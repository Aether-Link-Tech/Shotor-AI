// Minimal stand-in for the native llama.rn module in unit tests.
module.exports = {
  initLlama: jest.fn(async () => ({
    completion: jest.fn(async () => ({ text: 'mock', content: 'mock' })),
    stopCompletion: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  })),
};
