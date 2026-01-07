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





router.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ success: false, msg: 'No credential provided' });
  }

  if (credential === undefined) {
    res.status(400).json({ success: false, msg: 'No credential provided' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID, // Must match your client ID
    });
    const payload = ticket.getPayload();

    console.log("Payloads: ", { ...payload });

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
    } else {
      if (user.name !== payload.name) user.name = payload.name;
      await user.save();
    }

    await User.collection.updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } }
    );

    await RefreshToken.deleteMany({ userId: user._id });

    const accessPayload = { id: user._id, role: user.role };
    const accessToken = jwt.sign(accessPayload, JWT_SECRET, { expiresIn: '120m' });

    const refreshPayload = { id: user._id, role: user.role };
    const refreshTokenStr = jwt.sign(refreshPayload, REFRESH_SECRET, { expiresIn: '7d' });

    await RefreshToken.create({
      token: refreshTokenStr,
      userId: user._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    // Set httpOnly cookies (same as your login)
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 120 * 60 * 1000 // match expiry
    });
    res.cookie('refresh_token', refreshTokenStr, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    // Respond (similar to your login/register)
    const updatedUser = await User.findById(user._id).select('-password -__v');

    res.json({
      success: true,
      msg: 'Login successful',
      accessToken, // optional, if frontend needs it immediately
      user: updatedUser
    });

  } catch (err) {
    console.error('Google auth error:', err);
    res.status(400).json({ success: false, msg: 'Invalid Google credential' });
  }
});



router.post('/api/auth/verify-otp1', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    console.log('Missing email or otp');
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
      console.log('No matching user found - possible mismatch or expired');
      return res.status(400).json({
        success: false,
        msg: 'Invalid or expired verification code.',
      });
    }


    user.isOtpVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();


    // === Your existing token code below (keep it) ===
    await RefreshToken.deleteMany({ userId: user._id });

    const accessToken = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '120m' });
    const refreshTokenStr = jwt.sign({ id: user._id, role: user.role }, REFRESH_SECRET, { expiresIn: '7d' });

    await RefreshToken.create({
      token: refreshTokenStr,
      userId: user._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    res.cookie('access_token', accessToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 120 * 60 * 1000 });
    res.cookie('refresh_token', refreshTokenStr, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });

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

router.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, msg: 'Email and password required' });
  }

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ success: false, msg: 'Invalid credentials' });
    }

    // Critical: Block login until email is verified
    // if (!user.isOtpVerified) {
    //   return res.status(400).json({
    //     success: false,
    //     msg: 'Please verify your email first. Check your inbox or use "Resend OTP".',
    //   });
    // }

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

router.post('/api/auth/register', async (req, res) => {
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
        street: address.street || '',
        city: address.city || '',
        state: address.state || '',
        zip: address.zip || '',
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
      await User.findByIdAndDelete(newUser._id); // Cleanup
      return res.status(500).json({ success: false, msg: 'Failed to send verification email' });
    }

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


router.post('/api/auth/resend-otp', async (req, res) => {
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


router.post('/api/auth/logout', authMiddleware, async (req, res) => {
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


router.get('/api/auth/users', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 1000, status, name } = req.query;

    const pageNum = Math.max(parseInt(page), 1);
    const limitNum = Math.max(parseInt(limit), 1);

    // Base match for role and filters
    const matchStage = { role: 'Customer' };
    if (status) matchStage.status = status;
    if (name) matchStage.name = { $regex: name, $options: 'i' };

    // Aggregation pipeline
    const usersAggregation = await User.aggregate([
      { $match: matchStage },


      // Lookup orders
      {
        $lookup: {
          from: 'orders', // Ensure this matches your Order collection name in DB
          localField: '_id',
          foreignField: 'user', // Field in Order that references User._id
          as: 'orders'
        }
      },

      // Add orders count
      {
        $addFields: {
          ordersCount: { $size: '$orders' }
        }
      },

      // Project: exclude full orders array, keep only needed fields
      {
        $project: {
          orders: 0,
          password: 0, // Always exclude password
          __v: 0
        }
      },

      // Sort by latest
      { $sort: { createdAt: -1 } },

      // Facet for pagination and total count
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

    // Extract results
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

router.get('/api/auth/users/:id', authMiddleware, async (req, res) => {
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

    // Force amountDue to be included (even if 0)
    const paymentHistory = (user.paymentHistory || []).map(payment => ({
      ...payment.toObject(),
      amountDue: payment.amountDue ?? (payment.totalAmount - payment.amountPaid), // fallback
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



router.put('/api/auth/users/:id', authMiddleware, async (req, res) => {
  try {
    const { name, email, role, phone, status, petType } = req.body;

    // --- Address Handling ---
    let validAddress;
    if (req.body.address) {
      let address = req.body.address;

      // If coming as string (e.g. from FormData), parse it
      if (typeof address === 'string') {
        try {
          address = JSON.parse(address);
        } catch (err) {
          return res.status(400).json({ success: false, msg: 'Invalid address JSON format' });
        }
      }

      // Validate address object
      if (
        typeof address === 'object' &&
        address !== null &&
        address.street &&
        address.city &&
        address.state &&
        address.zip
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

    // --- Prepare update object dynamically ---
    const updateFields = {};
    if (name) updateFields.name = name;
    if (email) updateFields.email = email;
    if (role) updateFields.role = role;
    if (phone) updateFields.phone = phone;
    if (status) updateFields.status = status;
    if (petType) updateFields.petType = petType;
    if (validAddress) updateFields.address = validAddress;
    updateFields.updatedAt = new Date();

    // --- Update user ---
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



router.delete('/api/auth/users/:id', authMiddleware, async (req, res) => {
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

