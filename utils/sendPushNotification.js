// utils/sendPushNotification.js
const webPush = require('web-push');

// Configure VAPID
webPush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const sendNotification = async (subscription, title, body, data = {}) => {
  const payload = JSON.stringify({
    title,
    body,
    icon: '/logo192.png',
    badge: '/badge.png',
    data: { url: '/admin/orders', ...data }
  });

  try {
    await webPush.sendNotification(subscription, payload);
    console.log('Push sent successfully');
  } catch (error) {
    console.error('Error sending push:', error);
    
    
    if (error.statusCode === 410) {
      const PushSubscription = require('../model/PushSubscription');
      await PushSubscription.deleteOne({ endpoint: subscription.endpoint });
    }
  }
};

module.exports = { sendNotification };