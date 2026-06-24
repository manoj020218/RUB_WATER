const http = require('http');
const { createApp } = require('./src/app');

(async () => {
  const app = createApp({ resetStore: true, seed: true });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      login_id: 'operator_rub043',
      password: 'Pass@123',
      device_name: 'Regression Test Device',
      app_type: 'PWA'
    })
  });
  console.log('login status', login.status);
  const loginBody = await login.json();
  console.log(JSON.stringify(loginBody));
  const token = loginBody.data?.token;

  const res = await fetch(`http://127.0.0.1:${port}/api/commands/mute`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      location_id: 'RUB043',
      device_id: 'RUB043-CTRL01'
    })
  });
  console.log('mute status', res.status);
  console.log(await res.text());

  await new Promise((resolve) => server.close(resolve));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
