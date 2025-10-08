// routes/orders.js (Express Route for Creating and Updating Orders)
const express = require('express');
const router = express.Router();
const Order = require('../model/Order');
const auth = require('../middleware/auth'); // Assume middleware that sets req.user.id from JWT
const Product = require('../model/Product'); // To validate stock (optional)
const mongoose = require('mongoose');

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
router.post('/', auth, async (req, res) => {
  try {
    const { items, subtotal, tax, discount, total, paymentMethod, shippingAddress } = req.body;

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

    // // Recalculate subtotal from items to ensure consistency
    // const calculatedSubtotal = updatedItems.reduce((sum, it) => sum + it.total, 0);
    // if (Math.abs(calculatedSubtotal - subtotal) > 0.01) {
    //   return res.status(400).json({ success: false, msg: 'Subtotal mismatch with items.' });
    // }

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

// PUT /api/orders/:id/status - Update order status (e.g., to confirmed, shipped, delivered, cancelled)
router.put('/:id/status', auth, async (req, res) => {
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

// Optional: GET /api/orders - Fetch user's orders (for address saving/selection, but not required here)
router.get('/', auth, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id })
      .populate('items.product', 'name')
      .sort({ createdAt: -1 })
      .limit(10);
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, msg: 'Error fetching orders.' });
  }
});


router.delete('/:id', auth, async (req, res) => {
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



module.exports = router;