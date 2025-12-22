// routes/push.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const requireRole = roles => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};


// Subscribe to push notifications
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ success: false, msg: 'Invalid subscription data' });
    }

    const PushSubscription = require('../model/PushSubscription');

    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        user: req.user.id,           // Now safe – req.user exists
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        role: req.user.role
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, msg: 'Subscribed successfully' });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({ success: false, msg: 'Failed to subscribe' });
  }
});

// TEST ROUTE - Send notification to all subscribed admins
// Remove or protect this in production!
router.post('/test-send', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { title = 'Test Notification', body = 'This is a test from backend!', url = '/admin/orders' } = req.body;

    const PushSubscription = require('../model/PushSubscription');
    const { sendNotification } = require('../utils/sendPushNotification');

    const subscriptions = await PushSubscription.find({}); // or filter by role if needed

    if (subscriptions.length === 0) {
      return res.json({ success: false, msg: 'No subscriptions found' });
    }

    const results = [];
    for (const sub of subscriptions) {
      const subscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth
        }
      };

      try {
        await sendNotification(subscription, title, body, { url });
        results.push({ endpoint: sub.endpoint, status: 'sent' });
      } catch (error) {
        results.push({ endpoint: sub.endpoint, status: 'failed', error: error.message });
        
        // Auto-cleanup gone subscriptions
        if (error.statusCode === 410 || error.statusCode === 404) {
          await PushSubscription.deleteOne({ endpoint: sub.endpoint });
        }
      }
    }

    res.json({
      success: true,
      msg: `Test notification attempted to ${subscriptions.length} devices`,
      results
    });
  } catch (err) {
    console.error('Test send error:', err);
    res.status(500).json({ success: false, msg: 'Test failed' });
  }
});


// Optional: Unsubscribe (good practice)
router.post('/unsubscribe', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { endpoint } = req.body;
    const PushSubscription = require('../model/PushSubscription');
    await PushSubscription.deleteOne({ endpoint, user: req.user.id });
    res.json({ success: true, msg: 'Unsubscribed' });
  } catch (err) {
    res.status(500).json({ success: false, msg: 'Failed to unsubscribe' });
  }
});

module.exports = router;