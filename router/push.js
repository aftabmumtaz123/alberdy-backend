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