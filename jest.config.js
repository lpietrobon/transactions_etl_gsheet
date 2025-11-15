// Jest is configured so we can exercise the Apps Script helpers from Node-based unit tests.
module.exports = {
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'gs'],
  transform: {
    '^.+\\.gs$': 'babel-jest',
  },
};
