// routes/orders.js (Express Route for Creating and Updating Orders)
const express = require('express');
const router = express.Router();
const Order = require('../model/Order');
const Product = require('../model/Product'); // To validate stock (optional)
const User = require('../model/User'); // To populate customer info
const mongoose = require('mongoose');


// Auth and role middleware
const authMiddleware = require('../middleware/auth');
const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};




// Helper function to generate sequential order number (e.g., #ORD-001 to match UI)
const generateOrderNumber = async () => {
  try {
    const lastOrder = await Order.findOne().sort({ createdAt: -1 }).select('orderNumber');
    if (!lastOrder) return '#ORD-001';
    const lastNum = parseInt(lastOrder.orderNumber.replace('#ORD-', ''));
    const nextNum = lastNum + 1;
    const orderNumber = `#ORD-${nextNum.toString().padStart(3, '0')}`;
    console.log('Generated order number:', orderNumber);
    return orderNumber;
  } catch (err) {
    console.error('Error generating order number:', err);
    throw new Error('Failed to generate order number');
  }
};

// POST /api/orders - Create a new order from cart/checkout (without transactions for standalone MongoDB)
router.post('/', authMiddleware,  requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { items, subtotal, tax, discount, total, paymentMethod, shippingAddress, notes } = req.body;

    // Validation
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, msg: 'Order items are required.' });
    }
    if (!paymentMethod) {
      return res.status(400).json({ success: false, msg: 'Payment method is required.' });
    }
    if (!shippingAddress || !shippingAddress.street || !shippingAddress.city || !shippingAddress.zip || !shippingAddress.fullName || !shippingAddress.phone) {
      return res.status(400).json({ success: false, msg: 'Complete shipping address is required.' });
    }

    // Validate stock and prepare items (sequential, no session)
    const updatedItems = [];
    for (let item of items) {
      const product = await Product.findById(item.product);
      if (!product || product.stockQuantity < item.quantity) {
        return res.status(400).json({ success: false, msg: `Insufficient stock for ${product?.name || 'product'}.` });
      }
      updatedItems.push({
        product: item.product,
        quantity: item.quantity,
        price: product.price, // Snapshot current price
        total: product.price * item.quantity
      });
    }

    // Generate order number
    const orderNumber = await generateOrderNumber();

    // Calculate final total (ensure it matches: subtotal + tax + shipping - discount)
    const shipping = 5.99; // Fixed as per example
    const calculatedTotal = subtotal + (tax || 0) + shipping - (discount || 0);
    if (Math.abs(calculatedTotal - total) > 0.01) {
      return res.status(400).json({ success: false, msg: 'Total mismatch in order calculation.' });
    }

    // Create and save order
    const order = new Order({
      user: req.user.id,
      orderNumber, // Unique as per schema
      items: updatedItems,
      subtotal,
      tax: tax || 0,
      discount: discount || 0,
      shipping,
      total,
      paymentMethod,
      shippingAddress: {
        ...shippingAddress,
        country: shippingAddress.country || 'USA' // Add if needed
      },
      notes: notes || '',
      status: 'pending',
      paymentStatus: paymentMethod === 'COD' ? 'pending' : 'pending' // For online, handle separately
    });

    await order.save();

    // Deduct stock after order save (sequential; race condition possible but simple for standalone DB)
    for (let item of updatedItems) {
      const product = await Product.findById(item.product);
      if (product && product.stockQuantity >= item.quantity) {
        await Product.findByIdAndUpdate(item.product, { $inc: { stockQuantity: -item.quantity } });
      } else {
        console.warn(`Stock deduction skipped for ${item.product} - insufficient stock after order placement.`);
        // Optional: Mark order for manual review or notify
      }
    }

    // Populate items for response
    await order.populate('items.product', 'name price thumbnail images');

    res.status(201).json({
      success: true,
      order: order.toObject(), // Include _id, orderNumber, etc.
      msg: `Order ${orderNumber} placed successfully!`
    });

  } catch (err) {
    console.error('Order creation error:', err);
    if (err.code === 11000 && err.keyPattern && err.keyPattern.orderId) {
      // Specific handling for the legacy index error
      res.status(500).json({ success: false, msg: 'Legacy database index error. Please drop the "orderId_1" index on orders collection.' });
    } else {
      res.status(400).json({ success: false, msg: err.message });
    }
  }
});

// GET /api/orders - Fetch user's orders (list with pagination)
router.get('/', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = { user: req.user.id }; // User-specific; remove for admin all-orders

    const orders = await Order.find(query)
      .populate('items.product', 'name price')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    res.json({
      success: true,
      data: orders,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        total
      }
    });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ success: false, msg: 'Error fetching orders.' });
  }
});

// GET /api/orders/:id - Fetch single order details (matches UI)
router.get('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, msg: 'Invalid order ID.' });
    }

    const order = await Order.findOne({ _id: id, user: req.user.id }) // User-specific; remove for admin
      .populate('user', 'name email phone') // For customer info
      .populate('items.product', 'name price thumbnail images'); // For products table

    if (!order) {
      return res.status(404).json({ success: false, msg: 'Order not found or access denied.' });
    }

    // Format response to match UI (e.g., dates)
    const formattedOrder = {
      ...order.toObject(),
      createdAt: order.createdAt.toISOString().split('T')[0], // YYYY-MM-DD
      updatedAt: order.updatedAt.toISOString().split('T')[0],
      // Ensure shippingAddress has fullName (from user or input)
      shippingAddress: {
        ...order.shippingAddress,
        fullName: order.shippingAddress.fullName || order.user?.name || 'Unknown'
      }
    };

    res.json({
      success: true,
      order: formattedOrder
    });
  } catch (err) {
    console.error('Error fetching order details:', err);
    res.status(500).json({ success: false, msg: 'Server error fetching order details.' });
  }
});

// PUT /api/orders/:id - Full update order (e.g., address, notes, delivery info; restrict fields post-creation)
router.put('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { shippingAddress, notes, paymentStatus, deliveryAssigned, deliveryDate } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, msg: 'Invalid order ID.' });
    }

    // Restrict updates: Only allow if pending or for specific fields (e.g., no items/total after creation)
    const allowedUpdates = { shippingAddress, notes, paymentStatus, deliveryAssigned, deliveryDate };
    const updateData = {};
    for (const [key, value] of Object.entries(allowedUpdates)) {
      if (value !== undefined) updateData[key] = value;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, msg: 'No valid fields to update.' });
    }

    // Validate shippingAddress if provided
    if (updateData.shippingAddress) {
      const addr = updateData.shippingAddress;
      if (!addr.street || !addr.city || !addr.zip || !addr.fullName || !addr.phone) {
        return res.status(400).json({ success: false, msg: 'Complete shipping address is required.' });
      }
    }

    // Validate paymentStatus
    if (updateData.paymentStatus && !['pending', 'paid', 'failed'].includes(updateData.paymentStatus)) {
      return res.status(400).json({ success: false, msg: 'Invalid payment status.' });
    }

    const order = await Order.findOneAndUpdate(
      { _id: id, user: req.user.id }, // User-specific
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!order) {
      return res.status(404).json({ success: false, msg: 'Order not found or access denied.' });
    }

    // Populate for response
    await order.populate('items.product', 'name price thumbnail images');
    await order.populate('user', 'name email phone');

    res.json({
      success: true,
      order: order.toObject(),
      msg: `Order ${order.orderNumber} updated successfully.`
    });
  } catch (err) {
    console.error('Order update error:', err);
    res.status(400).json({ success: false, msg: err.message || 'Server error updating order.' });
  }
});

// PUT /api/orders/:id/status - Update order status (e.g., to confirmed, shipped, delivered, cancelled)
router.put('/:id/status', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validation
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, msg: 'Invalid order ID.' });
    }
    if (!status || !['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, msg: 'Invalid status. Must be one of: pending, confirmed, shipped, delivered, cancelled.' });
    }

    // Find and update order (only allow update if user is owner or admin; assume auth checks role)
    const order = await Order.findOneAndUpdate(
      { _id: id, user: req.user.id }, // Restrict to user's order; remove for admin access
      { status },
      { new: true } // Return updated document
    );

    if (!order) {
      return res.status(404).json({ success: false, msg: 'Order not found or access denied.' });
    }

    // Optional: Update paymentStatus if delivered and paid
    if (status === 'delivered' && order.paymentMethod === 'online') {
      await Order.findByIdAndUpdate(id, { paymentStatus: 'paid' });
    }

    // Populate for response
    await order.populate('items.product', 'name price thumbnail images');
    await order.populate('user', 'name email phone');

    res.json({
      success: true,
      order: order.toObject(),
      msg: `Order ${order.orderNumber} status updated to ${status}.`
    });
  } catch (err) {
    console.error('Order status update error:', err);
    res.status(500).json({ success: false, msg: 'Server error updating order status.' });
  }
});

router.delete('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']),  async (req, res) => {
  try {
    const { id } = req.params;

    // Validation
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, msg: 'Invalid order ID.' });
    }

    // Find and delete order (restrict to user's order; remove user filter for admin access)
    const order = await Order.findOneAndDelete({ _id: id, user: req.user.id });

    if (!order) {
      return res.status(404).json({ success: false, msg: 'Order not found or access denied.' });
    }

    // Optional: Restore stock if deleting (e.g., for cancelled orders)
    for (let item of order.items) {
      await Product.findByIdAndUpdate(item.product, { $inc: { stockQuantity: item.quantity } });
    }

    res.json({
      success: true,
      msg: `Order ${order.orderNumber} deleted successfully.`
    });
  } catch (err) {
    console.error('Order deletion error:', err);
    res.status(500).json({ success: false, msg: 'Server error deleting order.' });
  }
});
//Orders
module.exports = router;