const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');

const Order = require('../model/Order');
const Product = require('../model/Product');
const Variant = require('../model/variantProduct');
const User = require('../model/User');
const AppConfiguration = require('../model/app_configuration');
const SmtpConfig = require('../model/SmtpConfig');
const EmailTemplate = require('../model/EmailTemplate'); 
const authMiddleware = require('../middleware/auth');

const requireRole = roles => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};

const generateOrderNumber = async () => {
  const last = await Order.findOne().sort({ createdAt: -1 }).select('orderNumber');
  if (!last) return '#ORD-001';
  const num = parseInt(last.orderNumber.replace('#ORD-', '')) + 1;
  return `#ORD-${num.toString().padStart(3, '0')}`;
};

const generateTrackingNumber = async () => {
  const last = await Order.findOne().sort({ createdAt: -1 }).select('orderTrackingNumber');
  if (!last || !last.orderTrackingNumber) return '#TRK-LEY-321-001';
  const num = parseInt(last.orderTrackingNumber.replace('#TRK-LEY-321-', '')) + 1;
  return `#TRK-LEY-321-${num.toString().padStart(3, '0')}`;
};

/* ---------- Helper: fetch currency settings ---------- */
const getCurrencySettings = async () => {
  try {
    const config = await AppConfiguration.findOne().lean().select('currencyName currencyCode currencySign');
    if (!config) {
      return {
        currencyName: 'US Dollar',
        currencyCode: 'USD',
        currencySign: '$',
      };
    }
    return {
      currencyName: config.currencyName,
      currencyCode: config.currencyCode,
      currencySign: config.currencySign,
    };
  } catch (err) {
    console.error('Error fetching currency settings:', err);
    return {
      currencyName: 'US Dollar',
      currencyCode: 'USD',
      currencySign: '$',
    };
  }
};

/* ---------- Helper: Fetch Active SMTP Config ---------- */
const getActiveSmtpConfig = async () => {
  try {
    const config = await SmtpConfig.findOne({ status: 'active' }).lean();
    if (!config) {
      console.warn('No active SMTP config found');
      return null;
    }
    return config;
  } catch (err) {
    console.error('Error fetching SMTP config:', err);
    return null;
  }
};

/* ---------- Helper: Fetch Email Template ---------- */
const getEmailTemplate = async (type) => {
  try {
    const template = await EmailTemplate.findOne({ type, status: 'active' }).lean();
    if (!template) {
      console.warn(`No active template found for type: ${type}`);
      return null;
    }
    return template;
  } catch (err) {
    console.error(`Error fetching template for ${type}:`, err);
    return null;
  }
};

/* ---------- Helper: Render Template with Variables ---------- */
const renderTemplate = (content, variables) => {
  let rendered = content;
  for (const [key, value] of Object.entries(variables)) {
    rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
  }
  return rendered;
};

/* ---------- Helper: Create Transporter from SMTP Config ---------- */
const createTransporter = (smtpConfig) => {
  if (!smtpConfig) return null;
  return nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.encryption === 'SSL/TLS',
    auth: {
      user: smtpConfig.username,
      pass: smtpConfig.password,
    },
  });
};

/* ---------- Helper: Send Email using Config and Template ---------- */
const sendEmail = async (to, templateType, variables = {}) => {
  const smtpConfig = await getActiveSmtpConfig();
  if (!smtpConfig) return;

  const template = await getEmailTemplate(templateType);
  if (!template) return;

  const transporter = createTransporter(smtpConfig);
  if (!transporter) return;

  const subject = renderTemplate(template.subject, variables);
  const html = renderTemplate(template.content, variables);

  try {
    await transporter.sendMail({
      from: `${template.fromName} <${template.fromEmail}>`,
      to,
      subject,
      html,
    });
    console.log(`Email sent successfully to ${to} using template: ${templateType}`);
  } catch (err) {
    console.error(`Email sending error for ${templateType}:`, err);
  }
};

/* ---------- Helper: Check and Send Low Stock Alerts ---------- */
const checkAndSendLowStockAlerts = async (variants, adminEmail) => {
  const lowStockVariants = variants.filter(v => v.stockQuantity < 5);
  if (lowStockVariants.length === 0) return;

  const populatedVariants = await Promise.all(
    lowStockVariants.map(async (v) => {
      const product = await Product.findById(v.product);
      return { ...v, product };
    })
  );

  const lowStockItems = populatedVariants.map(v => `${v.product.name} - ${v.attribute}: ${v.value} (Stock: ${v.stockQuantity})`).join('<br>');
  const variables = { lowStockItems };
  await sendEmail(adminEmail, 'low_stock_alert', variables);
};

router.post('/', authMiddleware, requireRole(['Super Admin', 'Manager', 'Customer']), async (req, res) => {
  try {
    const {
      items, subtotal, tax = 0, discount = 0, total,
      paymentMethod, shippingAddress, notes, shipping = 5.99,
      paymentProvider, isPaymentVerified, paymentId, paymentResponse,
      paymentStatus
    } = req.body;


    if (!items?.length) return res.status(400).json({ success: false, msg: 'Order items required' });
    if (!paymentMethod) return res.status(400).json({ success: false, msg: 'Payment method required' });
    if (!shippingAddress?.street || !shippingAddress?.city || !shippingAddress?.zip ||
      !shippingAddress?.fullName || !shippingAddress?.phone || !shippingAddress?.email) {
      return res.status(400).json({ success: false, msg: 'Complete shipping address and email required' });
    }

    const orderItems = [];
    let computedSubtotal = 0;
    const variantsToCheck = [];

    for (const itm of items) {
      if (!mongoose.Types.ObjectId.isValid(itm.product))
        return res.status(400).json({ success: false, msg: `Invalid product ID: ${itm.product}` });

      const product = await Product.findById(itm.product)
        .populate({ path: 'variations', select: 'attribute value sku price discountPrice stockQuantity image product' });

      if (!product) return res.status(400).json({ success: false, msg: `Product not found: ${itm.product}` });
      if (!product.variations?.length)
        return res.status(400).json({ success: false, msg: `No variations for product ${product.name}` });

      const qty = Number(itm.quantity);
      if (isNaN(qty) || qty <= 0)
        return res.status(400).json({ success: false, msg: `Invalid quantity for ${product.name}` });

      if (!itm.variant)
        return res.status(400).json({ success: false, msg: `Variant required for ${product.name}` });

      if (!mongoose.Types.ObjectId.isValid(itm.variant))
        return res.status(400).json({ success: false, msg: `Invalid variant ID: ${itm.variant}` });

      const variant = product.variations.find(v => v._id.toString() === itm.variant);
      if (!variant) return res.status(400).json({ success: false, msg: `Variant not found` });

      if (variant.stockQuantity < qty)
        return res.status(400).json({ success: false, msg: `Insufficient stock for ${product.name} (${variant.attribute}: ${variant.value})` });

      const price = variant.discountPrice || variant.price;
      const lineTotal = price * qty;

      orderItems.push({
        product: itm.product,
        variant: itm.variant,
        quantity: qty,
        price,
        total: lineTotal
      });
      computedSubtotal += lineTotal;

      variantsToCheck.push(variant);
    }

    const calcTotal = subtotal + tax + shipping - discount;
    if (Math.abs(calcTotal - total) > 0.01)
      return res.status(400).json({ success: false, msg: 'Total amount mismatch' });

    const orderNumber = await generateOrderNumber();
    const trackingNumber = await generateTrackingNumber();
    const order = new Order({
      user: req.user.id,
      orderNumber,
      orderTrackingNumber: trackingNumber,
      items: orderItems,
      subtotal,
      tax,
      discount,
      shipping,
      total,
      paymentMethod,
      paymentProvider: paymentProvider || null,
      paymentId: paymentId || null,
      paymentResponse: paymentResponse || null,
      isPaymentVerified: isPaymentVerified || false,
      paymentStatus: paymentStatus || null,
      status: 'pending',
      trackingStatus: 'not shipped',
      shippingAddress,
      notes: notes || ''
    });

    await order.save();

    await order.populate('items.product', 'name thumbnail images');
    await order.populate({
      path: 'items.variant',
      select: 'attribute value sku price discountPrice stockQuantity image'
    });
    await order.populate('user', 'name email phone');

    // Push notifications (unchanged)
    try {
      const PushSubscription = require('../model/PushSubscription');
      const { sendNotification } = require('../utils/sendPushNotification');

      const adminSubs = await PushSubscription.find({
        role: { $in: ['Super Admin', 'Manager'] }
      }).select('endpoint keys');

      if (adminSubs.length > 0) {
        const currency = await getCurrencySettings();
        const totalFormatted = `${currency.currencySign}${total.toFixed(2)}`;

        const notificationPromises = adminSubs.map(sub =>
          sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            'New Order Received!',
            `${orderNumber} • ${totalFormatted} • ${paymentMethod.toUpperCase()}`,
            { orderId: order._id.toString(), url: `/admin/orders/${order._id}` }
          ).catch(err => console.warn('Failed to send push to one subscriber:', err.message))
        );

        Promise.allSettled(notificationPromises);
      }
    } catch (pushErr) {
      console.error('Push notification error (non-critical):', pushErr);
    }

    try {
      const currency = await getCurrencySettings();
      const totalFormatted = `${currency.currencySign}${total.toFixed(2)}`;

      // Customer: Order Placed
      const customerVariables = {
        user_name: order.user.name,
        order_number: order.orderNumber,
        order_trackingNumber: order.orderTrackingNumber,
        order_total: totalFormatted,
        order_status: order.status,
        order_paymentMethod: order.paymentMethod,
        shippingAddress: `${order.shippingAddress.fullName}, ${order.shippingAddress.street}, ${order.shippingAddress.city}, ${order.shippingAddress.zip}`,
      };
      await sendEmail(order.user.email, 'order_placed', customerVariables);

      const adminUser = await User.findOne({ role: { $in: ['Super Admin', 'Manager'] } }).select('email');
      if (adminUser) {
        const adminVariables = {
          order_number: order.orderNumber,
          order_total: totalFormatted,
          customer_name: order.user.name,
          customer_email: order.user.email,
          order_paymentMethod: paymentMethod,
        };
        await sendEmail(adminUser.email, 'order_placed', adminVariables); // Reuse template or create 'admin_order_alert'

        
        if (variantsToCheck.length > 0) {
          await checkAndSendLowStockAlerts(variantsToCheck, adminUser.email);
        }
      }
    } catch (emailErr) {
      console.error('Email notification error (non-critical):', emailErr);
    }

    res.status(201).json({
      success: true,
      data: order,
      msg: `Order ${orderNumber} placed successfully`
    });
  } catch (err) {
    console.error('Order creation error:', err);
    if (err.name === 'MongoServerError' && err.code === 11000)
      return res.status(400).json({ success: false, msg: 'Duplicate order/tracking number' });

    res.status(500).json({
      success: false,
      msg: 'Server error creating order',
      details: err.message
    });
  }
});

/* -------------------------- GET ONE ORDER -------------------------- */
router.get('/:id', authMiddleware, requireRole(['Super Admin', 'Manager', 'Customer']), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice stockQuantity image')
      .populate('user', 'name email phone');

    if (!order) return res.status(404).json({ success: false, msg: 'Order not found' });

    const currency = await getCurrencySettings();

    res.json({
      success: true,
      data: {
        order,
        currency,
      },
    });
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

/* -------------------------- LIST ORDERS -------------------------- */
router.get('/', authMiddleware, requireRole(['Super Admin', 'Manager', 'Customer']), async (req, res) => {
  try {
    const { page = 1, limit, status } = req.query;
    const query = status ? { status } : {};
    if (req.user.role === 'Customer') query.user = req.user.id;

    const orders = await Order.find(query)
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice effectivePrice total stockQuantity image product')
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    const currency = await getCurrencySettings();

    res.json({
      success: true,
      data: {
        orders,
        currency,
      },
      pagination: { current: +page, pages: Math.ceil(total / limit), total },
    });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

/* -------------------------- UPDATE ORDER -------------------------- */
router.put('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { shippingAddress, notes, paymentStatus, status, orderTrackingNumber, deliveryDate, deliveryPartner } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, msg: 'Invalid order ID' });

    const order = await Order.findById(id).populate('items.variant user');
    if (!order)
      return res.status(404).json({ success: false, msg: 'Order not found' });

    const oldStatus = order.status;

    const update = {};

    if (shippingAddress) update.shippingAddress = shippingAddress;
    if (notes) update.notes = notes;
    if (deliveryDate) update.deliveryDate = deliveryDate;
    if (deliveryPartner) update.deliveryPartner = deliveryPartner;
    if (orderTrackingNumber) update.orderTrackingNumber = orderTrackingNumber;

    if (status) {
      const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'];
      if (!validStatuses.includes(status))
        return res.status(400).json({ success: false, msg: `Invalid status: ${status}` });

      update.status = status;

      if (status === 'confirmed' && order.paymentMethod === 'COD') {
        update.paymentStatus = 'unpaid';
      } else if (status === 'delivered') {
        update.paymentStatus = 'paid';
      } else if (status === 'cancelled') {
        update.paymentStatus = 'unpaid';
      }
    }

    if (paymentStatus) {
      if (paymentStatus === 'paid' && order.status !== 'delivered') {
        return res.status(400).json({
          success: false,
          msg: 'COD payment can only be marked after delivery.'
        });
      }
      if (order.status === 'cancelled' && paymentStatus === 'paid') {
        return res.status(400).json({
          success: false,
          msg: 'Cancelled orders cannot have payment marked as paid'
        });
      }
      update.paymentStatus = paymentStatus;
    }

    if (status === 'cancelled') {
      for (const item of order.items) {
        if (item.variant && mongoose.Types.ObjectId.isValid(item.variant._id)) {
          await Variant.findByIdAndUpdate(
            item.variant._id,
            { $inc: { stockQuantity: item.quantity } },
            { runValidators: true }
          );
        }
      }
    }

    const updatedOrder = await Order.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true })
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice stockQuantity image')
      .populate('user', 'name email phone');

    // Status update email (dynamic)
    if (status && status !== oldStatus) {
      try {
        const currency = await getCurrencySettings();
        const totalFormatted = `${currency.currencySign}${updatedOrder.total.toFixed(2)}`;
        const variables = {
          user_name: updatedOrder.user.name,
          order_number: updatedOrder.orderNumber,
          order_status: updatedOrder.status,
          order_oldStatus: oldStatus,
          order_total: totalFormatted,
          order_trackingNumber: updatedOrder.orderTrackingNumber,
        };
        await sendEmail(updatedOrder.user.email, 'order_status_updated', variables);
      } catch (emailErr) {
        console.error('Status update email error (non-critical):', emailErr);
      }
    }

    res.json({
      success: true,
      data: updatedOrder,
      msg: `Order ${updatedOrder.orderNumber} updated successfully`
    });
  } catch (err) {
    console.error('Order update error:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

router.delete('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, msg: 'Invalid order ID' });

    const order = await Order.findById(id)
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice stockQuantity image');

    if (!order) return res.status(404).json({ success: false, msg: 'Order not found' });
    if (order.status === 'delivered' || order.paymentStatus === 'paid')
      return res.status(400).json({ success: false, msg: 'Cannot delete delivered/paid orders' });

    if (order.status === 'pending') {
      for (const item of order.items) {
        if (item.variant) {
          await Variant.findByIdAndUpdate(item.variant, { $inc: { stockQuantity: item.quantity } });
        }
      }
      await Order.findByIdAndDelete(id);
      res.json({ success: true, data: order, msg: `Order ${order.orderNumber} deleted successfully` });
    } else {
      return res.status(400).json({ success: false, msg: 'Only pending orders can be deleted' });
    }
  } catch (err) {
    console.error('Error deleting order:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

/* -------------------------- UPDATE TRACKING -------------------------- */
router.put('/:id/tracking', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { trackingStatus, orderTrackingNumber } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, msg: 'Invalid order ID' });

    const valid = ['not shipped', 'shipped', 'in transit', 'out for delivery', 'delivered', 'cancelled'];
    if (trackingStatus && !valid.includes(trackingStatus))
      return res.status(400).json({ success: false, msg: `Invalid tracking status: ${trackingStatus}` });

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ success: false, msg: 'Order not found' });

    if (trackingStatus && ['delivered', 'cancelled'].includes(order.trackingStatus))
      return res.status(400).json({
        success: false,
        msg: `Cannot change tracking from ${order.trackingStatus}`
      });

    if (orderTrackingNumber) {
      const exists = await Order.findOne({ orderTrackingNumber, _id: { $ne: id } });
      if (exists) return res.status(400).json({ success: false, msg: 'Tracking number already used' });
    }

    const upd = {};
    if (trackingStatus) upd.trackingStatus = trackingStatus;
    if (orderTrackingNumber) upd.orderTrackingNumber = orderTrackingNumber;
    if (!Object.keys(upd).length) return res.status(400).json({ success: false, msg: 'Nothing to update' });

    const updated = await Order.findByIdAndUpdate(id, { $set: upd }, { new: true })
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice stockQuantity image')
      .populate('user', 'name email phone');

    res.json({ success: true, data: updated, msg: `Tracking updated for ${updated.orderNumber}` });
  } catch (err) {
    console.error('Error updating tracking:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

/* -------------------------- PUBLIC TRACKING LOOKUP -------------------------- */
router.get('/track/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    const query = mongoose.Types.ObjectId.isValid(identifier)
      ? { _id: identifier }
      : { orderTrackingNumber: identifier };

    const order = await Order.findOne(query)
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice stockQuantity image')
      .populate('user', 'name email phone');

    if (!order) return res.status(404).json({ success: false, msg: 'Order not found' });

    if (req.user?.role === 'Customer' && order.user.toString() !== req.user.id)
      return res.status(403).json({ success: false, msg: 'Access denied' });

    const slim = {
      orderNumber: order.orderNumber,
      orderTrackingNumber: order.orderTrackingNumber,
      trackingStatus: order.trackingStatus,
      status: order.status,
      shippingAddress: order.shippingAddress,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items: order.items
    };

    const currency = await getCurrencySettings();

    res.json({
      success: true,
      data: {
        order: slim,
        currency,
      },
      msg: `Tracking for ${order.orderNumber}`
    });
  } catch (err) {
    console.error('Error tracking order:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

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

router.get('/key/public-key', (req, res) => {
  res.json({
    success: true,
    publicKey: process.env.VAPID_PUBLIC_KEY
  });
});

router.post('/:orderId/refund-request', authMiddleware, async (req, res) => {
  try {
    const { reason } = req.body;

    const order = await Order.findById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ msg: 'Order not found' });
    }

    if (
      order.user.toString() !== req.user.id &&
      !['Super Admin', 'Manager'].includes(req.user.role)
    ) {
      return res.status(403).json({ msg: 'Not allowed' });
    }

    if (order.paymentStatus !== 'paid') {
      return res.status(400).json({ msg: 'Only paid orders can be refunded' });
    }

    if (order.status === 'returned' || order.paymentStatus === 'refunded') {
      return res.status(400).json({ msg: 'Refund already requested or processed' });
    }

    order.status = 'returned';
    order.paymentStatus = 'refunded';
    order.refundReason = reason || 'No reason provided';
    order.refundRequestedAt = new Date();

    await order.save();

    res.json({
      success: true,
      msg: 'Refund request submitted successfully',
      order
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Refund request failed' });
  }
});

router.post('/verify-payment', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { orderId, isPaymentVerified, reason } = req.body;

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        success: false,
        msg: 'Valid orderId is required'
      });
    }

    if (typeof isPaymentVerified !== 'boolean') {
      return res.status(400).json({
        success: false,
        msg: 'isPaymentVerified must be a boolean (true/false)'
      });
    }

    const order = await Order.findById(orderId)
      .populate('items.product', 'name')
      .populate('user', 'name email');

    if (!order) {
      return res.status(404).json({
        success: false,
        msg: 'Order not found'
      });
    }

    if (order.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        msg: 'Cannot modify payment status of cancelled orders'
      });
    }

    const previousPaymentStatus = order.paymentStatus;
    const previousIsVerified = order.isPaymentVerified;

    if (isPaymentVerified === true) {
      if (order.isPaymentVerified === true) {
        return res.status(400).json({
          success: false,
          msg: 'Payment is already verified'
        });
      }

      if (order.status === 'returned') {
        return res.status(400).json({
          success: false,
          msg: 'Cannot verify payment for returned orders'
        });
      }

      order.isPaymentVerified = true;
      order.paymentStatus = 'paid';
      order.paymentVerifiedAt = new Date();
      order.paymentVerifiedBy = req.user.id;

      if (order.status === 'pending') {
        order.status = 'confirmed';
      }
    } else {
      if (order.paymentStatus === 'refunded') {
        return res.status(400).json({
          success: false,
          msg: 'Cannot unverify refunded orders'
        });
      }

      order.isPaymentVerified = false;
      order.paymentStatus = 'unpaid';
      order.paymentVerifiedAt = null;
      order.paymentVerifiedBy = null;
    }

    if (!order.paymentHistory) order.paymentHistory = [];
    order.paymentHistory.push({
      action: isPaymentVerified ? 'mark-paid' : 'mark-unpaid',
      previousStatus: previousPaymentStatus,
      newStatus: order.paymentStatus,
      previousVerified: previousIsVerified,
      newVerified: order.isPaymentVerified,
      reason: reason || 'No reason provided',
      performedBy: req.user.id,
      performedByRole: req.user.role,
      timestamp: new Date()
    });

    await order.save();

    // Payment confirmation email (dynamic)
    if (isPaymentVerified) {
      try {
        const currency = await getCurrencySettings();
        const totalFormatted = `${currency.currencySign}${order.total.toFixed(2)}`;
        const variables = {
          user_name: order.user.name,
          order_number: order.orderNumber,
          order_total: totalFormatted,
          order_status: order.status,
          order_paymentMethod: order.paymentMethod,
        };
        await sendEmail(order.user.email, 'payment_confirmation', variables);
      } catch (emailErr) {
        console.error('Payment confirmation email error (non-critical):', emailErr);
      }
    }

    res.json({
      success: true,
      msg: `Payment verification ${isPaymentVerified ? 'enabled' : 'disabled'}`,
      data: {
        orderNumber: order.orderNumber,
        previousStatus: previousPaymentStatus,
        newStatus: order.paymentStatus,
        previousVerified: previousIsVerified,
        newVerified: order.isPaymentVerified,
        updatedBy: req.user.name || req.user.email
      }
    });
  } catch (err) {
    console.error('Payment verification error:', err);
    res.status(500).json({
      success: false,
      msg: 'Server error during payment verification',
      details: err.message
    });
  }
});

module.exports = router;