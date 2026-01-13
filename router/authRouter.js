const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../model/User');
const Order = require('../model/Order');
const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.REFRESH_SECRET;
const authMiddleware = require('../middleware/auth');
const RefreshToken = require('../model/refreshToken');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const crypto = require('crypto');
const sendEmail = require('../utils/sendEmail');
const { createNotification } = require('../utils/createNotification');

// ────────────────────────────────────────────────
// Notify admins about new user registration
// (email + push + in-app notification)
// ────────────────────────────────────────────────
async function notifyAdminsNewUser(name, email, role, userId) {
  try {
    // 1. Email notification
    const admins = await User.find({
      role: { $in: ['Super Admin', 'Manager'] },
      status: 'Active'
    }).select('email');

    if (admins.length > 0) {
      const adminEmails = admins.map(a => a.email).join(',');

      const adminHtml = `
        <h2>New User Registration</h2>
        <p>A new user has just registered:</p>
        <ul>
          <li><strong>Name:</strong> ${name || 'N/A'}</li>
          <li><strong>Email:</strong> ${email}</li>
          <li><strong>Role:</strong> ${role}</li>
          <li><strong>Time:</strong> ${new Date().toISOString()}</li>
        </ul>
        <p>View user: <a href="${process.env.FRONTEND_URL || 'https://your-app.com'}/admin/users/${userId}">Click here</a></p>
      `;

      await sendEmail(adminEmails, 'New User Registration - Albreedy Pet Shop', adminHtml);
    }

    // 2. Web Push notification
    const PushSubscription = require('../model/PushSubscription');
    const { sendNotification } = require('../utils/sendPushNotification');

    const adminSubs = await PushSubscription.find({
      role: { $in: ['Super Admin', 'Manager'] }
    }).select('endpoint keys').lean();

    if (adminSubs.length > 0) {
      const pushPromises = adminSubs.map(sub =>
        sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          'New User Registered',
          `${name || email} (${role}) just signed up.`,
          {
            userId: userId.toString(),
            url: `/admin/users/${userId}`
          }
        ).catch(err => console.warn('Push failed for new user:', err.message))
      );

      await Promise.allSettled(pushPromises);
    }

    // 3. In-app bell notifications (per admin)
    const adminUsers = await User.find({
      role: { $in: ['Super Admin', 'Manager'] }
    }).select('_id').lean();

    if (adminUsers.length > 0) {
      const message = `${name || email} (${role}) registered a new account`;

      for (const admin of adminUsers) {
        await createNotification({
          userId: admin._id,
          type: 'account_registration',
          title: 'New User Registered',
          message: message,
          related: { userId: userId.toString() }
        }).catch(err => console.error('In-app notification failed for new user:', err));
      }
    }

  } catch (err) {
    console.error('Failed to notify admins about new user:', err);
  }
}

// ────────────────────────────────────────────────
// Google Sign-in / Sign-up
// ────────────────────────────────────────────────
router.post('/api/v1/auth/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ success: false, msg: 'No credential provided' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload.email_verified) {
      return res.status(400).json({ success: false, msg: 'Email not verified by Google' });
    }

    let user = await User.findOne({ email: payload.email });

    if (!user) {
      const newUser = new User({
        name: payload.name || payload.email.split('@')[0],
        email: payload.email,
        role: 'Customer',
      });
      await newUser.save();
      user = newUser;

      // Notify admins (email + push + in-app)
      await notifyAdminsNewUser(user.name, user.email, user.role, user._id);
    } else {
      if (user.name !== payload.name) {
        user.name = payload.name;
        await user.save();
      }
    }

    await User.collection.updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } }
    );

    await RefreshToken.deleteMany({ userId: user._id });

    const accessToken = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '120m' });
    const refreshTokenStr = jwt.sign({ id: user._id, role: user.role }, REFRESH_SECRET, { expiresIn: '7d' });

    await RefreshToken.create({
      token: refreshTokenStr,
      userId: user._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 120 * 60 * 1000,
    });
    res.cookie('refresh_token', refreshTokenStr, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const updatedUser = await User.findById(user._id).select('-password -__v');

    res.json({
      success: true,
      msg: 'Login successful',
      accessToken,
      user: updatedUser,
    });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(400).json({ success: false, msg: 'Invalid Google credential' });
  }
});

// ────────────────────────────────────────────────
// OTP Verification + Login
// ────────────────────────────────────────────────
router.post('/api/v1/auth/verify-otp1', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ success: false, msg: 'Email and OTP required' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedOtp = String(otp).trim();

  try {
    const user = await User.findOne({
      email: normalizedEmail,
      otp: normalizedOtp,
      otpExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        msg: 'Invalid or expired verification code.',
      });
    }

    user.isOtpVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    await RefreshToken.deleteMany({ userId: user._id });

    const accessToken = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '120m' });
    const refreshTokenStr = jwt.sign({ id: user._id, role: user.role }, REFRESH_SECRET, { expiresIn: '7d' });

    await RefreshToken.create({
      token: refreshTokenStr,
      userId: user._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 120 * 60 * 1000,
    });
    res.cookie('refresh_token', refreshTokenStr, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const updatedUser = await User.findById(user._id).select('-password -__v');

    res.json({
      success: true,
      msg: 'Email verified successfully! You are now logged in.',
      accessToken,
      user: updatedUser,
    });
  } catch (err) {
    console.error('Server error in verify-otp:', err);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
});

// ────────────────────────────────────────────────
// Email + Password Login
// ────────────────────────────────────────────────
router.post('/api/v1/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, msg: 'Email and password required' });
  }

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ success: false, msg: 'Invalid credentials' });
    }

    if (!(await user.comparePassword(password))) {
      return res.status(400).json({ success: false, msg: 'Invalid credentials' });
    }

    if (user.status !== 'Active') {
      return res.status(400).json({ success: false, msg: 'Account inactive' });
    }

    await User.collection.updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } }
    );

    await RefreshToken.deleteMany({ userId: user._id });

    const accessToken = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '120m' });
    const refreshTokenStr = jwt.sign({ id: user._id, role: user.role }, REFRESH_SECRET, { expiresIn: '7d' });

    await RefreshToken.create({
      token: refreshTokenStr,
      userId: user._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 120 * 60 * 1000,
    });
    res.cookie('refresh_token', refreshTokenStr, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const updatedUser = await User.findById(user._id).select('-password -__v');

    res.json({
      success: true,
      msg: 'Login successful',
      accessToken,
      user: updatedUser,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
});

// ────────────────────────────────────────────────
// Register (email + password)
// ────────────────────────────────────────────────
router.post('/api/v1/auth/register', async (req, res) => {
  const { name, email, password, cPassword, role = 'Customer', address, petType } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, msg: 'Name, email, and password are required' });
  }
  if (password !== cPassword) {
    return res.status(400).json({ success: false, msg: 'Passwords do not match' });
  }
  if (!['Super Admin', 'Manager', 'Staff', 'Customer'].includes(role)) {
    return res.status(400).json({ success: false, msg: 'Invalid role' });
  }

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      if (existingUser.isOtpVerified) {
        return res.status(400).json({ success: false, msg: 'User with this email already exists' });
      } else {
        return res.status(400).json({
          success: false,
          msg: 'Email already registered but not verified. Please check your email or resend OTP.',
        });
      }
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpExpires = Date.now() + 10 * 60 * 1000;

    let validAddress = undefined;
    if (address && typeof address === 'object' && address !== null) {
      validAddress = {
        street: address.street?.trim() || '',
        city: address.city?.trim() || '',
        state: address.state?.trim() || '',
        zip: address.zip?.trim() || '',
      };
    }

    const newUser = new User({
      name,
      email,
      password,
      role,
      address: validAddress,
      petType,
      isOtpVerified: false,
      otp,
      otpExpires,
    });
    await newUser.save();

    // Send OTP email
    const html = `
      <h2>Welcome to Albreedy Pet Shop!</h2>
      <p>Hello ${name},</p>
      <p>Your 6-digit verification code is:</p>
      <h1 style="font-size: 32px; letter-spacing: 10px; color: #2563eb;"><strong>${otp}</strong></h1>
      <p>This code expires in <strong>10 minutes</strong>.</p>
      <p>If you didn't register, please ignore this email.</p>
    `;

    try {
      await sendEmail(email, 'Verify Your Email - Albreedy Pet Shop', html);
    } catch (emailErr) {
      console.error('Failed to send OTP email:', emailErr);
      await User.findByIdAndDelete(newUser._id);
      return res.status(500).json({ success: false, msg: 'Failed to send verification email' });
    }

    // Notify admins (email + push + in-app bell notification)
    await notifyAdminsNewUser(name, email, role, newUser._id);

    res.status(201).json({
      success: true,
      msg: 'Registration successful! Check your email for the 6-digit verification code.',
      userId: newUser._id,
      email: newUser.email,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, msg: 'Server error during registration' });
  }
});

// ────────────────────────────────────────────────
// Resend OTP
// ────────────────────────────────────────────────
router.post('/api/v1/auth/resend-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, msg: 'Email is required' });

  try {
    const user = await User.findOne({ email, isOtpVerified: false });
    if (!user) {
      return res.status(400).json({
        success: false,
        msg: 'No pending verification found. You may already be verified.',
      });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    user.otp = otp;
    user.otpExpires = Date.now() + 10 * 60 * 1000;
    await user.save();

    const html = `
      <h2>New Verification Code</h2>
      <p>Hello ${user.name},</p>
      <p>Your new 6-digit code is:</p>
      <h1 style="font-size: 32px; letter-spacing: 10px; color: #2563eb;"><strong>${otp}</strong></h1>
      <p>Valid for 10 minutes.</p>
    `;

    await sendEmail(email, 'New Verification Code - Albreedy', html);

    res.json({ success: true, msg: 'New verification code sent!' });
  } catch (err) {
    console.error('Resend OTP error:', err);
    res.status(500).json({ success: false, msg: 'Failed to resend code' });
  }
});

// ────────────────────────────────────────────────
// Logout
// ────────────────────────────────────────────────
router.post('/api/v1/auth/logout', authMiddleware, async (req, res) => {
  try {
    await RefreshToken.deleteOne({ userId: req.user.id });
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    res.json({ success: true, msg: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ success: false, msg: 'Server error during logout' });
  }
});

// ────────────────────────────────────────────────
// Admin: List Users (with orders count)
// ────────────────────────────────────────────────
router.get('/api/v1/auth/users', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 1000, status, name } = req.query;

    const pageNum = Math.max(parseInt(page), 1);
    const limitNum = Math.max(parseInt(limit), 1);

    const matchStage = { role: 'Customer' };
    if (status) matchStage.status = status;
    if (name) matchStage.name = { $regex: name, $options: 'i' };

    const usersAggregation = await User.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: 'orders',
          localField: '_id',
          foreignField: 'user',
          as: 'orders'
        }
      },
      {
        $addFields: {
          ordersCount: { $size: '$orders' }
        }
      },
      {
        $project: {
          orders: 0,
          password: 0,
          __v: 0
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          data: [
            { $skip: (pageNum - 1) * limitNum },
            { $limit: limitNum }
          ],
          total: [{ $count: 'count' }]
        }
      }
    ]);

    const total = usersAggregation[0]?.total[0]?.count || 0;
    const users = usersAggregation[0]?.data || [];

    res.json({
      success: true,
      data: users,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        hasNextPage: pageNum * limitNum < total,
        hasPrevPage: pageNum > 1
      }
    });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching users' });
  }
});

// ────────────────────────────────────────────────
// Get single user (with payment history)
// ────────────────────────────────────────────────
router.get('/api/v1/auth/users/:id', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -__v')
      .populate({
        path: 'paymentHistory',
        select: 'totalAmount amountPaid amountDue payment_method invoiceNo status date notes createdAt',
        options: { sort: { date: -1 } },
      });

    if (!user) {
      return res.status(404).json({ success: false, msg: 'User not found' });
    }

    if (user.role !== 'Customer') {
      return res.status(403).json({
        success: false,
        msg: 'Access denied. Only customers can be viewed with payment details.',
      });
    }

    const ordersCount = await Order.countDocuments({ user: user._id });

    const paymentHistory = (user.paymentHistory || []).map(payment => ({
      ...payment.toObject(),
      amountDue: payment.amountDue ?? (payment.totalAmount - payment.amountPaid),
    }));

    const response = {
      ...user.toObject(),
      paymentHistory,
      ordersCount,
    };

    res.json({ success: true, data: response });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching user' });
  }
});

// ────────────────────────────────────────────────
// Update user
// ────────────────────────────────────────────────
router.put('/api/v1/auth/users/:id', authMiddleware, async (req, res) => {
  try {
    const { name, email, role, phone, status, petType } = req.body;

    let validAddress;
    if (req.body.address) {
      let address = req.body.address;
      if (typeof address === 'string') {
        try {
          address = JSON.parse(address);
        } catch {
          return res.status(400).json({ success: false, msg: 'Invalid address JSON format' });
        }
      }

      if (
        typeof address === 'object' &&
        address !== null &&
        address.street && address.city && address.state && address.zip
      ) {
        validAddress = {
          street: address.street.trim(),
          city: address.city.trim(),
          state: address.state.trim(),
          zip: address.zip.trim(),
        };
      } else {
        return res.status(400).json({
          success: false,
          msg: 'Address must include street, city, state, and zip fields',
        });
      }
    }

    const updateFields = {};
    if (name) updateFields.name = name;
    if (email) updateFields.email = email;
    if (role) updateFields.role = role;
    if (phone) updateFields.phone = phone;
    if (status) updateFields.status = status;
    if (petType) updateFields.petType = petType;
    if (validAddress) updateFields.address = validAddress;
    updateFields.updatedAt = new Date();

    const user = await User.findByIdAndUpdate(req.params.id, updateFields, {
      new: true,
      runValidators: true,
      select: '-password -__v',
    });

    if (!user) {
      return res.status(404).json({ success: false, msg: 'User not found' });
    }

    res.json({
      success: true,
      msg: 'User updated successfully',
      data: user,
    });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ success: false, msg: 'Server error updating user' });
  }
});

// ────────────────────────────────────────────────
// Delete user
// ────────────────────────────────────────────────
router.delete('/api/v1/auth/users/:id', authMiddleware, async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.id);
    if (!deletedUser) {
      return res.status(404).json({ success: false, msg: 'User not found' });
    }
    res.json({ success: true, msg: 'User deleted successfully' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ success: false, msg: 'Server error deleting user' });
  }
});

module.exports = router;