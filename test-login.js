import handler from './api/auth/login.js';

const mockReq = {
  method: 'POST',
  body: {
    identifier: 'test@example.com',
    password: 'password123'
  }
};

const mockRes = {
  status: (code) => {
    console.log('Status:', code);
    return mockRes;
  },
  json: (data) => {
    console.log('JSON:', JSON.stringify(data, null, 2));
    return mockRes;
  },
  setHeader: (name, value) => {
    console.log('Header:', name, '=', value);
    return mockRes;
  }
};

console.log('Starting local test...');
handler(mockReq, mockRes).catch(err => {
  console.error('Unhandled Error in handler:', err);
});
