const express = require('express')
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../model/User');
const JWT_SECRET = process.env.JWT_SECRET; // Fallback for dev; use env in prod
const REFRESH_SECRET = process.env.REFRESH_SECRET; // Fallback for dev; use env in prod
const authMiddleware = require('../middleware/auth');
const RefreshToken = require('../model/refreshToken');
// Login Route (fixed password comparison and address fix using raw collection update)
router.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, msg: 'Email and password required' });
  }
  try {
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(400).json({ success: false, msg: 'Invalid credentials' });
    }
    if (user.status !== 'Active') {
      return res.status(400).json({ success: false, msg: 'Account inactive' });
    }
    // Fix malformed address if it's not an object (legacy data issue) using raw collection update
    if (user.address && typeof user.address !== 'object') {
      await User.collection.updateOne(
        { _id: user._id },
        { $set: { address: { street: '', city: '', state: '', zip: '' } } }
      );
    }
    // Update last login using raw collection update
    await User.collection.updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } }
    );
    // Fetch updated user for response (exclude password)
    const updatedUser = await User.findById(user._id).select('-password -__v');
    // Generate Access Token (short-lived)
    const accessPayload = { id: user._id, role: user.role };
    const accessToken = jwt.sign(accessPayload, JWT_SECRET, { expiresIn: '120m' });
    // Generate Refresh Token (long-lived)
    const refreshPayload = { id: user._id, role: user.role };
    const refreshTokenStr = jwt.sign(refreshPayload, REFRESH_SECRET, { expiresIn: '7d' });
    // Store Refresh Token in DB
    await RefreshToken.create({
      token: refreshTokenStr,
      userId: user._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    });
    // Set Cookies
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000 // 15 minutes
    });
    res.cookie('refresh_token', refreshTokenStr, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    // Response (send access token in body for API use; cookies for browser)
    res.json({
      success: true,
      accessToken, // For immediate use
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        role: updatedUser.role,
        address: updatedUser.address,
        email: updatedUser.email
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
});
// Register Route (with address validation to prevent malformed data)
router.post('/api/auth/register', async (req, res) => {
  const { name, email, password, cPassword, role = 'Customer', address, petType } = req.body;
  // Validation
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, msg: 'Name, email, and password are required' });
  }
  if (!['Super Admin', 'Manager', 'Staff', 'Customer'].includes(role)) {
    return res.status(400).json({ success: false, msg: 'Invalid role specified' });
  }
  if(password !== cPassword) {
    return res.status(400).json({ success: false, msg: 'Password and Confirm Password do not match' });
  }
  try {
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, msg: 'User with this email already exists' });
    }
    //check if admin already exist
    if(role !== 'Customer'){
      const adminExist = await User.findOne({ role: { $in: ['Super Admin', 'Manager', 'Staff'] } });
      if (adminExist) {
        return res.status(400).json({ success: false, msg: 'Admin already exist' });
      }
    }
    // Handle address: ensure it's a valid object or omit
    let validAddress = undefined;
    if (address && typeof address === 'object' && address !== null) {
      validAddress = {
        street: address.street || '',
        city: address.city || '',
        state: address.state || '',
        zip: address.zip || ''
      };
    } else if (address) {
      // If address is string or invalid, log warning and omit (or error if required)
      console.warn('Invalid address format provided during registration; omitting address.');
    }
    const newUser = new User({
      name,
      email,
      password, // Will be hashed automatically
      role,
      address: validAddress,
      petType // Optional for customers
    });
    await newUser.save();
    // Generate Access Token
    const accessPayload = { id: newUser._id, role: newUser.role };
    const accessToken = jwt.sign(accessPayload, JWT_SECRET, { expiresIn: '1h' });
    // Generate Refresh Token
    const refreshPayload = { id: newUser._id, role: newUser.role };
    const refreshTokenStr = jwt.sign(refreshPayload, REFRESH_SECRET, { expiresIn: '7d' });
    await RefreshToken.create({
      token: refreshTokenStr,
      userId: newUser._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });
    // Set Cookies
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 1000
    });
    res.cookie('refresh_token', refreshTokenStr, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.status(201).json({
      success: true,
      msg: 'User registered successfully',
      accessToken, // For immediate use
      user: {
        id: newUser._id,
        name: newUser.name,
        role: newUser.role,
        address: newUser.address,
        email: newUser.email
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, msg: 'Server error during registration' });
  }
});
// Optional: Logout Route (revoke refresh token)
router.post('/api/auth/logout', authMiddleware, async (req, res) => {
  try {
    // Delete refresh token from DB
    await RefreshToken.deleteOne({ userId: req.user.id });
    // Clear cookies
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
    const { page = 1, limit = 10, status, name } = req.query;
    const query = {
      role: 'Customer'
    };
    if (status) query.status = status;
    if (name) query.name = { $regex: name, $options: 'i' };
    const pageNum = Math.max(parseInt(page), 1);
    const limitNum = Math.max(parseInt(limit), 1);
    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);
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
// 👤 Get single user by ID
router.get('/api/auth/users/:id', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password -__v');
    if (!user) {
      return res.status(404).json({ success: false, msg: 'User not found' });
    }
    res.json({ success: true, data: user });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching user' });
  }
});
// Update User Route (with address handling)
router.put('/api/auth/users/:id', authMiddleware, async (req, res) => {
  try {
    const { name, email, role, phone, address, status } = req.body;
    // Address is required during update: must be provided and complete (all fields non-empty)
    let validAddress = undefined;
    if (address) {
      if (typeof address === 'object' && address !== null && address.street && address.city && address.state && address.zip) {
        validAddress = {
          street: address.street.trim(),
          city: address.city.trim(),
          state: address.state.trim(),
          zip: address.zip.trim()
        };
      } else {
        return res.status(400).json({ success: false, msg: 'Complete address (street, city, state, zip) is required during update and must be a valid object' });
      }
    } else {
      return res.status(400).json({ success: false, msg: 'Address is required during update' });
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, email, role, phone, address: validAddress, status, updatedAt: new Date() },
      { new: true, runValidators: true, select: '-password -__v' }
    );
    if (!user) {
      return res.status(404).json({ success: false, msg: 'User not found' });
    }
    res.json({ success: true, msg: 'User updated successfully', data: user });
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
