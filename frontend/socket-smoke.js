const { io } = require('socket.io-client');
const s = io('http://localhost:3000', { transports: ['websocket'], timeout: 5000 });
let done = false;
s.on('connect', () => {
  console.log('connected');
  done = true;
  s.close();
  process.exit(0);
});
s.on('connect_error', (err) => {
  console.error('connect_error', err.message);
  process.exit(2);
});
setTimeout(() => {
  if (!done) {
    console.error('timeout');
    process.exit(3);
  }
}, 7000);
