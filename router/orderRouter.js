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
const PushSubscription = require('../model/PushSubscription');
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
  try {
    await OrderCounter.findOneAndUpdate(
      { type: 'tracking' },
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    );
    const counter = await OrderCounter.findOne({ type: 'tracking' });
    return `#TRK-LEY-321-${counter.seq.toString().padStart(3, '0')}`;
  } catch (err) {
    console.error('Error generating tracking number:', err);
    return '#TRK-LEY-321-001';  // Fallback
  }
};

/* ---------- Helper: Fetch Currency Settings ---------- */
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
  if (!smtpConfig) {
    console.warn('SMTP config unavailable – email skipped');
    return false;
  }

  const template = await getEmailTemplate(templateType);
  if (!template) {
    console.warn(`Template unavailable for ${templateType} – email skipped`);
    return false;
  }

  const transporter = createTransporter(smtpConfig);
  if (!transporter) {
    console.error('Failed to create transporter');
    return false;
  }

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
    return true;
  } catch (err) {
    console.error(`Email sending error for ${templateType}:`, err);
    return false;
  }
};

/* ---------- Helper: Check and Send Low Stock Alerts ---------- */
const checkAndSendLowStockAlerts = async (variants, adminEmail) => {
  const lowStockVariants = variants.filter(v => v.stockQuantity < 5);
  if (lowStockVariants.length === 0) return;

  try {
    const populatedVariants = await Promise.all(
      lowStockVariants.map(async (v) => {
        const product = await Product.findById(v.product).lean();
        return { ...v, product };
      })
    );

    const lowStockItems = populatedVariants.map(v => `${v.product.name} - ${v.attribute}: ${v.value} (Stock: ${v.stockQuantity})`).join('<br>');
    const variables = { lowStockItems };
    await sendEmail(adminEmail, 'low_stock_alert', variables);
  } catch (err) {
    console.error('Low stock alert error:', err);
  }
};

/* -------------------------- CREATE ORDER -------------------------- */
router.post('/', authMiddleware, requireRole(['Super Admin', 'Manager', 'Customer']), async (req, res) => {
  try {
    const {
      items, subtotal, tax = 0, discount = 0, total,
      paymentMethod, shippingAddress, notes, shipping = 5.99,
      paymentProvider, isPaymentVerified, paymentId, paymentResponse,
      paymentStatus
    } = req.body;

    // Validation
    if (!items?.length) return res.status(400).json({ success: false, msg: 'Order items required' });
    if (!paymentMethod) return res.status(400).json({ success: false, msg: 'Payment method required' });
    if (!shippingAddress?.street || !shippingAddress?.city || !shippingAddress?.zip ||
      !shippingAddress?.fullName || !shippingAddress?.phone || !shippingAddress?.email) {
      return res.status(400).json({ success: false, msg: 'Complete shipping address and email required' });
    }

    const orderItems = [];
    let computedSubtotal = 0;
    const variantsToCheck = [];

    // Process items with stock check & decrement (optimistic – rollback on error)
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

    // Decrement stock (transaction for atomicity)
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      for (const item of orderItems) {
        await Variant.findByIdAndUpdate(
          item.variant,
          { $inc: { stockQuantity: -item.quantity } },
          { session }
        );
      }
      await session.commitTransaction();
    } catch (stockErr) {
      await session.abortTransaction();
      await order.deleteOne();
      throw new Error('Stock update failed – order rolled back');
    } finally {
      session.endSession();
    }

    // Populate for response
    await order.populate('items.product', 'name thumbnail images');
    await order.populate({
      path: 'items.variant',
      select: 'attribute value sku price discountPrice stockQuantity image'
    });
    await order.populate('user', 'name email phone');

    // Push notifications
    try {
      const { sendNotification } = require('../utils/sendPushNotification');

      const adminSubs = await PushSubscription.find({
        role: { $in: ['Super Admin', 'Manager'] },
        endpoint: { $exists: true, $ne: null },
        'keys.p256dh': { $exists: true }
      }).select('endpoint keys').lean();

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

        await Promise.allSettled(notificationPromises);
      }
    } catch (pushErr) {
      console.error('Push notification error (non-critical):', pushErr);
    }

    // Emails
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

      const adminUser = await User.findOne({ role: { $in: ['Super Admin', 'Manager'] } }).select('email').lean();
      if (adminUser) {
        const adminVariables = {
          order_number: order.orderNumber,
          order_total: totalFormatted,
          customer_name: order.user.name,
          customer_email: order.user.email,
          order_paymentMethod: paymentMethod,
        };
        await sendEmail(adminUser.email, 'admin_order_alert', adminVariables);  // Dedicated template

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
      .populate('user', 'name email phone')
      .lean();

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
    const { page = 1, limit = 10, status } = req.query;  // Default limit for prod
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));  // Cap at 100
    const query = status ? { status } : {};
    if (req.user.role === 'Customer') query.user = req.user.id;

    const orders = await Order.find(query)
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice effectivePrice total stockQuantity image product')
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean();

    const total = await Order.countDocuments(query);

    const currency = await getCurrencySettings();

    res.json({
      success: true,
      data: {
        orders,
        currency,
      },
      pagination: { 
        current: pageNum, 
        pages: Math.ceil(total / limitNum), 
        total,
        limit: limitNum 
      },
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

    const order = await Order.findById(id).populate('items.variant user').lean();
    if (!order)
      return res.status(404).json({ success: false, msg: 'Order not found' });

    const oldStatus = order.status;

    const update = { updatedAt: new Date() };

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

    // Restock on cancel (transaction)
    if (status === 'cancelled') {
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        for (const item of order.items) {
          if (item.variant && mongoose.Types.ObjectId.isValid(item.variant._id)) {
            await Variant.findByIdAndUpdate(
              item.variant._id,
              { $inc: { stockQuantity: item.quantity } },
              { session, runValidators: true }
            );
          }
        }
        await session.commitTransaction();
      } catch (stockErr) {
        await session.abortTransaction();
        throw stockErr;
      } finally {
        session.endSession();
      }
    }

    const updatedOrder = await Order.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true })
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice stockQuantity image')
      .populate('user', 'name email phone')
      .lean();

    // Status update email
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

/* -------------------------- DELETE ORDER -------------------------- */
router.delete('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, msg: 'Invalid order ID' });

    const order = await Order.findById(id)
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice stockQuantity image')
      .lean();

    if (!order) return res.status(404).json({ success: false, msg: 'Order not found' });
    if (order.status === 'delivered' || order.paymentStatus === 'paid')
      return res.status(400).json({ success: false, msg: 'Cannot delete delivered/paid orders' });

    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, msg: 'Only pending orders can be deleted' });
    }

    // Restock (transaction)
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      for (const item of order.items) {
        if (item.variant) {
          await Variant.findByIdAndUpdate(item.variant, { $inc: { stockQuantity: item.quantity } }, { session });
        }
      }
      await Order.findByIdAndDelete(id, { session });
      await session.commitTransaction();
    } catch (stockErr) {
      await session.abortTransaction();
      throw stockErr;
    } finally {
      session.endSession();
    }

    res.json({ success: true, data: order, msg: `Order ${order.orderNumber} deleted successfully` });
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

    const order = await Order.findById(id).lean();
    if (!order) return res.status(404).json({ success: false, msg: 'Order not found' });

    if (trackingStatus && ['delivered', 'cancelled'].includes(order.trackingStatus))
      return res.status(400).json({
        success: false,
        msg: `Cannot change tracking from ${order.trackingStatus}`
      });

    if (orderTrackingNumber) {
      const exists = await Order.findOne({ orderTrackingNumber, _id: { $ne: id } }).lean();
      if (exists) return res.status(400).json({ success: false, msg: 'Tracking number already used' });
    }

    const upd = { updatedAt: new Date() };
    if (trackingStatus) upd.trackingStatus = trackingStatus;
    if (orderTrackingNumber) upd.orderTrackingNumber = orderTrackingNumber;
    if (!Object.keys(upd).length) return res.status(400).json({ success: false, msg: 'Nothing to update' });

    const updated = await Order.findByIdAndUpdate(id, { $set: upd }, { new: true })
      .populate('items.product', 'name thumbnail images')
      .populate('items.variant', 'attribute value sku price discountPrice stockQuantity image')
      .populate('user', 'name email phone')
      .lean();

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
      .populate('user', 'name email phone')
      .lean();

    if (!order) return res.status(404).json({ success: false, msg: 'Order not found' });

    // Partial auth for customers
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

/* -------------------------- PUSH SUBSCRIPTION -------------------------- */
router.post('/subscribe', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return res.status(400).json({ success: false, msg: 'Valid subscription required (endpoint + keys)' });
    }

    // Validate key lengths
    const { Buffer } = require('buffer');
    if (Buffer.from(subscription.keys.p256dh, 'base64').length !== 65) {
      return res.status(400).json({ success: false, msg: 'p256dh key must be 65 bytes' });
    }
    if (Buffer.from(subscription.keys.auth, 'base64').length < 16) {
      return res.status(400).json({ success: false, msg: 'auth key too short' });
    }

    const updatedSub = await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        user: req.user.id,  // Real user now
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        role: req.user.role
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, msg: 'Subscribed to notifications' });
  } catch (err) {
    console.error('Subscription error:', err);
    res.status(500).json({ success: false, msg: 'Server error during subscription' });
  }
});

/* -------------------------- VAPID PUBLIC KEY -------------------------- */
router.get('/key/public-key', (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(500).json({ success: false, msg: 'VAPID keys not configured' });
  }
  res.json({
    success: true,
    publicKey: process.env.VAPID_PUBLIC_KEY
  });
});

/* -------------------------- REFUND REQUEST -------------------------- */
router.post('/:orderId/refund-request', authMiddleware, async (req, res) => {
  try {
    const { reason } = req.body;

    const order = await Order.findById(req.params.orderId).lean();
    if (!order) {
      return res.status(404).json({ success: false, msg: 'Order not found' });
    }

    if (
      order.user.toString() !== req.user.id &&
      !['Super Admin', 'Manager'].includes(req.user.role)
    ) {
      return res.status(403).json({ success: false, msg: 'Not allowed' });
    }

    if (order.paymentStatus !== 'paid') {
      return res.status(400).json({ success: false, msg: 'Only paid orders can be refunded' });
    }

    if (order.status === 'returned' || order.paymentStatus === 'refunded') {
      return res.status(400).json({ success: false, msg: 'Refund already requested or processed' });
    }

    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.orderId,
      {
        status: 'returned',
        paymentStatus: 'refunded',
        refundReason: reason || 'No reason provided',
        refundRequestedAt: new Date(),
        updatedAt: new Date()
      },
      { new: true }
    ).lean();

    res.json({
      success: true,
      msg: 'Refund request submitted successfully',
      data: updatedOrder
    });
  } catch (err) {
    console.error('Refund error:', err);
    res.status(500).json({ success: false, msg: 'Refund request failed', details: err.message });
  }
});

/* -------------------------- VERIFY PAYMENT -------------------------- */
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
      .populate('user', 'name email')
      .lean();

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

    const update = { updatedAt: new Date() };

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

      update.isPaymentVerified = true;
      update.paymentStatus = 'paid';
      update.paymentVerifiedAt = new Date();
      update.paymentVerifiedBy = req.user.id;

      if (order.status === 'pending') {
        update.status = 'confirmed';
      }
    } else {
      if (order.paymentStatus === 'refunded') {
        return res.status(400).json({
          success: false,
          msg: 'Cannot unverify refunded orders'
        });
      }

      update.isPaymentVerified = false;
      update.paymentStatus = 'unpaid';
      update.paymentVerifiedAt = null;
      update.paymentVerifiedBy = null;
    }

    if (!order.paymentHistory) update.paymentHistory = [];
    update.paymentHistory = order.paymentHistory.concat({
      action: isPaymentVerified ? 'mark-paid' : 'mark-unpaid',
      previousStatus: previousPaymentStatus,
      newStatus: update.paymentStatus,
      previousVerified: previousIsVerified,
      newVerified: update.isPaymentVerified,
      reason: reason || 'No reason provided',
      performedBy: req.user.id,
      performedByRole: req.user.role,
      timestamp: new Date()
    });

    const updatedOrder = await Order.findByIdAndUpdate(orderId, { $set: update }, { new: true }).lean();

    // Payment confirmation email
    if (isPaymentVerified) {
      try {
        const currency = await getCurrencySettings();
        const totalFormatted = `${currency.currencySign}${updatedOrder.total.toFixed(2)}`;
        const variables = {
          user_name: updatedOrder.user.name,
          order_number: updatedOrder.orderNumber,
          order_total: totalFormatted,
          order_status: updatedOrder.status,
          order_paymentMethod: updatedOrder.paymentMethod,
        };
        await sendEmail(updatedOrder.user.email, 'payment_confirmation', variables);
      } catch (emailErr) {
        console.error('Payment confirmation email error (non-critical):', emailErr);
      }
    }

    res.json({
      success: true,
      msg: `Payment verification ${isPaymentVerified ? 'enabled' : 'disabled'}`,
      data: {
        orderNumber: updatedOrder.orderNumber,
        previousStatus: previousPaymentStatus,
        newStatus: updatedOrder.paymentStatus,
        previousVerified: previousIsVerified,
        newVerified: updatedOrder.isPaymentVerified,
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