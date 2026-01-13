// utils/createNotification.js
const Notification = require('../model/Notification.js');

async function createNotification({ userId, type, title, message, related = {} }) {
  try {
    const notification = await Notification.create({
      user: userId,
      type,
      title,
      message,
      relatedOrder: related.orderId,
      relatedUser: related.userId,
      relatedProduct: related.productId,
    });
    return notification;
  } catch (err) {
    console.error(`Failed to create ${type} notification:`, err);
    return null;
  }
}

module.exports = { createNotification };