<?php
/**
 * Plugin Name:  Mavo Picture Tag
 * Plugin URI:   https://github.com/mamanvoyage/mavo-picture-tag
 * Description:  Adds a TinyMCE button to insert fully-responsive &lt;picture&gt; tags (WebP + JPEG/PNG sources, auto-detected from the media library). Requires the Classic Editor plugin.
 * Version:      2.6.0
 * Author:       Mavo
 * License:      GPL-2.0-or-later
 * Requires WP:  6.0
 * Requires PHP: 7.4
 * Requires Plugins: classic-editor
 *
 * @package MavoPictureTag
 */

defined( 'ABSPATH' ) || exit;

define( 'MAVO_PICTURE_TAG_VERSION', '2.6.0' );
define( 'MAVO_PICTURE_TAG_DIR', plugin_dir_path( __FILE__ ) );
define( 'MAVO_PICTURE_TAG_URL', plugin_dir_url( __FILE__ ) );

require_once MAVO_PICTURE_TAG_DIR . 'includes/class-mavo-picture-tag.php';

add_action( 'plugins_loaded', static function () {
	Mavo_Picture_Tag::get_instance();
} );
