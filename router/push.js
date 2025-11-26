router.post('/subscribe', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  const { subscription } = req.body;
  const PushSubscription = require('../model/PushSubscription');

  await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      user: req.user.id,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      role: req.user.role
    },
    { upsert: true, new: true }
  );

  res.json({ success: true, msg: 'Subscribed to notifications' });
});