const webPush = require('web-push');

const sendNotification = async (subscription, title, body, data = {}) => {
  if (!subscription?.endpoint) {
    console.error('Missing endpoint:', subscription);
    return;
  }

  if (!subscription.keys?.p256dh || !subscription.keys?.auth) {
    console.error('Missing keys:', subscription);
    return;
  }

  try {
    const p256dhBuf = Buffer.from(subscription.keys.p256dh, 'base64url');
    if (p256dhBuf.length !== 65) {
      console.error(`Invalid p256dh length ${p256dhBuf.length} for ${subscription.endpoint}`);
      // Optionally delete bad sub here
      await PushSubscription.deleteOne({ endpoint: subscription.endpoint });
      return;
    }
  } catch (e) {
    console.error('Invalid p256dh format:', e);
    return;
  }

  const payload = JSON.stringify({
    title,
    body,
    icon: '/logo192.png',
    badge: '/badge.png',
    data: { url: '/admin/orders', ...data }
  });

  try {
    await webPush.sendNotification(subscription, payload);
    console.log(`Push sent to ${subscription.endpoint}`);
  } catch (error) {
    console.error('Error sending push:', error);

    if (error.statusCode === 410 || error.statusCode === 404) {
      const PushSubscription = require('../model/PushSubscription');
      await PushSubscription.deleteOne({ endpoint: subscription.endpoint });
      console.log(`Removed expired/gone subscription: ${subscription.endpoint}`);
    }
  }
};



module.exports = { sendNotification };