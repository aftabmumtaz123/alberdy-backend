const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const Notification = require('../model/Notification');

// Get my notifications (newest first)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;

    const query = { user: req.user._id };
    if (unreadOnly === 'true') query.isRead = false;

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean()
      .select('-__v'); // remove version key

    const total = await Notification.countDocuments(query);

    res.json({
      success: true,
      data: notifications,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        unreadCount: unreadOnly ? notifications.length : await Notification.countDocuments({ user: req.user._id, isRead: false })
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load notifications' });
  }
});

// Mark one as read
router.patch('/:id/read', authMiddleware, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found or not yours' });
    }

    res.json({ success: true, data: notification });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete one
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await Notification.deleteOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Not found or not yours' });
    }

    res.json({ success: true, message: 'Notification deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Clear all my notifications
router.delete('/', authMiddleware, async (req, res) => {
  try {
    const result = await Notification.deleteMany({ user: req.user._id });

    res.json({
      success: true,
      message: `Cleared ${result.deletedCount} notifications`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;