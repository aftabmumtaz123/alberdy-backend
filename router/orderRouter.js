// routes/orders.js (Express Route for Creating and Updating Orders)
const express = require('express');
const router = express.Router();
const Order = require('../model/Order');
const Product = require('../model/Product'); // To validate stock (optional)
const Variation = require('../model/Variants_product'); // NEW: For separate variation documents
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
router.post('/', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { items, subtotal, tax, discount, total, paymentMethod, shippingAddress, notes, shipping = 5.99 } = req.body; // Dynamic shipping

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

    // Validate stock and prepare items (with variant support)
    const updatedItems = [];
    let computedSubtotal = 0;
    for (let item of items) {
      if (!mongoose.Types.ObjectId.isValid(item.product)) {
        return res.status(400).json({ success: false, msg: `Invalid product ID: ${item.product}` });
      }
      // NEW: Populate variations since they are referenced (array of IDs in DB)
      const product = await Product.findById(item.product).populate('variations');
      if (!product) {
        return res.status(400).json({ success: false, msg: `Product not found: ${item.product}` });
      }

      let stockToCheck, priceToUse, variant = null;
      const quantity = Number(item.quantity); // Coerce to number for safety
      if (isNaN(quantity) || quantity <= 0) {
        return res.status(400).json({ success: false, msg: `Invalid quantity for product ${item.product}: ${item.quantity}` });
      }

      if (item.variant) { // Optional: item.variant as ObjectId string
        if (!mongoose.Types.ObjectId.isValid(item.variant)) {
          return res.status(400).json({ success: false, msg: `Invalid variant ID: ${item.variant}` });
        }
        // Find populated variant object
        variant = product.variations?.find(v => v._id.toString() === item.variant.toString());
        if (!variant) {
          return res.status(400).json({ success: false, msg: `Variant not found for product ${product.name}` });
        }
        if (variant.stockQuantity < quantity) {
          return res.status(400).json({ success: false, msg: `Insufficient stock for variant ${variant.sku || variant.value} in ${product.name}. Available: ${variant.stockQuantity}` });
        }
        stockToCheck = variant.stockQuantity;
        priceToUse = variant.price;
      } else {
        // Base product fallback
        if (product.stockQuantity < quantity) {
          return res.status(400).json({ success: false, msg: `Insufficient stock for ${product.name}. Available: ${product.stockQuantity}` });
        }
        stockToCheck = product.stockQuantity;
        priceToUse = product.price;
      }

      // Validate priceToUse to prevent NaN/undefined in schema
      if (typeof priceToUse !== 'number' || isNaN(priceToUse) || priceToUse <= 0) {
        const priceSource = item.variant ? `variant ${item.variant}` : `product ${item.product}`;
        return res.status(400).json({ 
          success: false, 
          msg: `Invalid price for ${priceSource}: ${priceToUse}. Please check the product/variant data in the database.` 
        });
      }

      const itemTotal = priceToUse * quantity;
      if (isNaN(itemTotal)) { // Extra safety (shouldn't happen now)
        return res.status(400).json({ success: false, msg: `Failed to calculate total for item: ${priceToUse} * ${quantity}` });
      }

      updatedItems.push({
        product: item.product,
        variant: item.variant || null, // Store variant ID
        quantity,
        price: priceToUse, // Snapshot variant or base price
        total: itemTotal
      });
      computedSubtotal += itemTotal;
    }

    // Validate provided subtotal against computed
    if (Math.abs(computedSubtotal - subtotal) > 0.01) {
      return res.status(400).json({ success: false, msg: `Subtotal mismatch: provided ${subtotal}, computed ${computedSubtotal.toFixed(2)}.` });
    }

    // Generate order number
    const orderNumber = await generateOrderNumber();

    // Calculate final total (ensure it matches: subtotal + tax + shipping - discount)
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
        country: shippingAddress.country || 'USA'
      },
      notes: notes || '',
      status: 'pending',
      paymentStatus: paymentMethod === 'COD' ? 'pending' : 'pending' // For online, handle separately
    });

    await order.save();

    // Deduct stock (after save for consistency; use atomic $inc)
    // Group by product/variation to avoid redundant fetches (optimization)
    const productsToUpdate = {};
    const variationsToUpdate = {}; // NEW: Track unique variations
    for (let item of updatedItems) {
      if (item.variant) {
        if (!variationsToUpdate[item.variant]) {
          variationsToUpdate[item.variant] = await Variation.findById(item.variant);
        }
        const variation = variationsToUpdate[item.variant];
        if (variation && variation.stockQuantity >= item.quantity) {
          await Variation.findByIdAndUpdate(variation._id, { $inc: { stockQuantity: -item.quantity } });
        }
      } else {
        if (!productsToUpdate[item.product]) {
          productsToUpdate[item.product] = await Product.findById(item.product);
        }
        const product = productsToUpdate[item.product];
        if (product && product.stockQuantity >= item.quantity) {
          await Product.findByIdAndUpdate(product._id, { $inc: { stockQuantity: -item.quantity } });
        }
      }
    }

    // Populate items for response (no need for variations populate if embedded)
    await order.populate('items.product', 'name price thumbnail images');

    res.status(201).json({
      success: true,
      data: order.toObject(),
      msg: `Order ${orderNumber} placed successfully!`
    });

  } catch (err) {
    console.error('Order creation error:', err.message || err);
    if (err.name === 'CastError' && err.path === 'variations') {
      return res.status(400).json({ success: false, msg: 'Invalid variations field in request. Ensure it\'s an array of valid ObjectIds or omit it.' });
    }
    if (err.code === 11000 && err.keyPattern && err.keyPattern.orderId) {
      res.status(500).json({ success: false, msg: 'Legacy database index error. Please drop the "orderId_1" index on orders collection.' });
    } else {
      res.status(400).json({ success: false, msg: err.message || 'Server error creating order' });
    }
  }
});

// GET /api/orders/:id - Get order by ID
router.get('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id)
      .populate('items.product', 'name price thumbnail images')
      .populate('user', 'name email phone');
    if (!order) {
      return res.status(404).json({ success: false, msg: 'Order not found' });
    }
    res.status(200).json({
      success: true,
      data: order.toObject()
    });
  } catch (error) {
    console.error('Error fetching order:', error.message || error);
    res.status(500).json({ success: false, msg: 'Server error fetching order', details: error.message || 'Unknown error' });
  }
});

// GET /api/orders - Fetch all orders (list with pagination)
router.get('/', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {};
    if (status) query.status = status;

    const orders = await Order.find(query)
      .populate('items.product', 'name price thumbnail images')
      .populate('user', 'name email phone')
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
    console.error('Error fetching orders:', err.message || err);
    res.status(500).json({ success: false, msg: 'Error fetching orders.', details: err.message || 'Unknown error' });
  }
});

// PUT /api/orders/:id - Full update order (e.g., address, notes, delivery info; restrict fields post-creation)
router.put('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { shippingAddress, notes, paymentStatus, deliveryAssigned, deliveryDate, status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, msg: 'Invalid order ID.' });
    }

    const allowedUpdates = { shippingAddress, notes, paymentStatus, deliveryAssigned, deliveryDate, status };
    const updateData = {};
    for (const [key, value] of Object.entries(allowedUpdates)) {
      if (value !== undefined) updateData[key] = value;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, msg: 'No valid fields to update.' });
    }

    // Validate status if provided
    if (updateData.status && !['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'].includes(updateData.status)) {
      return res.status(400).json({ success: false, msg: 'Invalid status. Must be one of: pending, confirmed, shipped, delivered, cancelled.' });
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

    // Validate deliveryDate if provided
    if (updateData.deliveryDate) {
      if (isNaN(new Date(updateData.deliveryDate).getTime())) {
        return res.status(400).json({ success: false, msg: 'Invalid delivery date format.' });
      }
      updateData.deliveryDate = new Date(updateData.deliveryDate);
    }

    const order = await Order.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!order) {
      return res.status(404).json({ success: false, msg: 'Order not found.' });
    }

    // Populate for response
    await order.populate('items.product', 'name price thumbnail images');
    await order.populate('user', 'name email phone');

    res.json({
      success: true,
      data: order.toObject(),
      msg: `Order ${order.orderNumber} updated successfully.`
    });
  } catch (err) {
    console.error('Order update error:', err.message || err);
    res.status(400).json({ success: false, msg: err.message || 'Server error updating order.', details: err.message || 'Unknown error' });
  }
});

// DELETE /api/orders/:id - Delete order by ID (restore stock if applicable)
router.delete('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, msg: 'Invalid order ID.' });
    }

    // Find the order first to restore stock and get details
    const order = await Order.findById(id)
      .populate('items.product', 'name price thumbnail images')
      .populate('user', 'name email phone');

    if (!order) {
      return res.status(404).json({ success: false, msg: 'Order not found.' });
    }

    // Optional: Prevent deletion if status is 'delivered' or 'paid' (business rule)
    if (order.status === 'delivered' || order.paymentStatus === 'paid') {
      return res.status(400).json({ success: false, msg: 'Cannot delete delivered or paid orders.' });
    }

    // Restore stock (reverse deduction)
    const productsToUpdate = {};
    const variationsToUpdate = {};
    for (let item of order.items) {
      const quantity = Number(item.quantity);
      if (item.variant) {
        if (!variationsToUpdate[item.variant]) {
          variationsToUpdate[item.variant] = await Variation.findById(item.variant);
        }
        const variation = variationsToUpdate[item.variant];
        if (variation) {
          await Variation.findByIdAndUpdate(variation._id, { $inc: { stockQuantity: quantity } });
        }
      } else {
        if (!productsToUpdate[item.product]) {
          productsToUpdate[item.product] = await Product.findById(item.product);
        }
        const product = productsToUpdate[item.product];
        if (product) {
          await Product.findByIdAndUpdate(product._id, { $inc: { stockQuantity: quantity } });
        }
      }
    }

    // Delete the order
    await Order.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      data: order.toObject(),  // Return deleted order details
      msg: `Order ${order.orderNumber} deleted successfully! Stock restored.`
    });

  } catch (err) {
    console.error('Order deletion error:', err.message || err);
    res.status(500).json({ success: false, msg: 'Server error deleting order.', details: err.message || 'Unknown error' });
  }
});

module.exports = router;