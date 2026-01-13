const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const Notification = require('../model/Notification');

const requireRole = roles => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};

// GET /notifications - Fetch current user's notifications
router.get('/', authMiddleware, requireRole(['Super Admin', 'Manager', 'Customer']), async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = 'false' } = req.query;
    const pageNum = Math.max(Number(page), 1);
    const limitNum = Math.max(Number(limit), 1);

    // Filter by current logged-in user
    const query = {};

    if (unreadOnly === 'true') {
      query.isRead = false;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean()
      .select('-__v');

    const total = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({ user: req.user._id, isRead: false });

    res.json({
      success: true,
      data: notifications,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        unreadCount
      }
    });
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ success: false, message: 'Failed to load notifications' });
  }
});

// PATCH /notifications/:id/read - Mark as read
router.patch('/:id/read', authMiddleware, requireRole(['Super Admin', 'Manager', 'Customer']), async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { isRead: true },
      { new: true, select: '-__v' }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found or not yours' });
    }

    res.json({ success: true, data: notification });
  } catch (err) {
    console.error('Error marking notification as read:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /notifications/:id - Delete one
router.delete('/:id', authMiddleware, requireRole(['Super Admin', 'Manager', 'Customer']), async (req, res) => {
  try {
    const result = await Notification.deleteOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found or not yours' });
    }

    res.json({ success: true, message: 'Notification deleted' });
  } catch (err) {
    console.error('Error deleting notification:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /notifications - Clear all for current user
router.delete('/', authMiddleware, requireRole(['Super Admin', 'Manager', 'Customer']), async (req, res) => {
  try {
    const result = await Notification.deleteMany({ user: req.user._id });

    res.json({
      success: true,
      message: `Cleared ${result.deletedCount} notification${result.deletedCount !== 1 ? 's' : ''}`
    });
  } catch (err) {
    console.error('Error clearing notifications:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;