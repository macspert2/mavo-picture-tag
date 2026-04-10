<?php
/**
 * Core plugin class.
 *
 * Responsibilities:
 *  - Registers the TinyMCE plugin and toolbar button.
 *  - Enqueues the wp.media script on post-edit screens and passes
 *    AJAX config to the JS layer.
 *  - Handles the AJAX request that returns all image sizes (with
 *    optional WebP URLs) for a given attachment.
 *  - Shows an admin notice when the Classic Editor plugin is inactive.
 *
 * @package MavoPictureTag
 */

defined( 'ABSPATH' ) || exit;

class Mavo_Picture_Tag {

	/** @var self|null */
	private static $instance = null;

	public static function get_instance(): self {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		// Admin notice when Classic Editor is missing.
		add_action( 'admin_notices', [ $this, 'notice_classic_editor' ] );

		// Only wire up TinyMCE hooks when user can edit posts.
		add_action( 'admin_init', [ $this, 'register_tinymce_hooks' ] );

		// Enqueue wp.media + pass JS config on post-edit screens.
		add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_editor_assets' ] );

		// Output CSS fixes (TinyMCE dialog background + Quicktags modal styles).
		add_action( 'admin_head', [ $this, 'output_admin_css' ] );

		// AJAX: return all image sizes for an attachment.
		add_action( 'wp_ajax_mavo_get_attachment_sizes', [ $this, 'ajax_get_attachment_sizes' ] );
	}

	/* ------------------------------------------------------------------ */
	/*  Admin notice                                                        */
	/* ------------------------------------------------------------------ */

	public function notice_classic_editor(): void {
		// Only show on plugin/plugin-install screens and only to admins.
		$screen = get_current_screen();
		if ( ! $screen || ! current_user_can( 'activate_plugins' ) ) {
			return;
		}

		if ( $this->classic_editor_active() ) {
			return;
		}

		?>
		<div class="notice notice-warning">
			<p>
				<strong>Mavo Picture Tag</strong>:
				<?php esc_html_e(
					'The Classic Editor plugin is required for the Picture Tag button to appear in TinyMCE. Please install and activate it.',
					'mavo-picture-tag'
				); ?>
			</p>
		</div>
		<?php
	}

	/* ------------------------------------------------------------------ */
	/*  TinyMCE hooks                                                       */
	/* ------------------------------------------------------------------ */

	public function register_tinymce_hooks(): void {
		if ( ! current_user_can( 'edit_posts' ) && ! current_user_can( 'edit_pages' ) ) {
			return;
		}
		if ( 'true' !== get_user_option( 'rich_editing' ) ) {
			return;
		}

		add_filter( 'mce_buttons',           [ $this, 'add_tinymce_button' ] );
		add_filter( 'mce_external_plugins',  [ $this, 'register_tinymce_plugin' ] );
	}

	/** Append the button name to TinyMCE toolbar row 1. */
	public function add_tinymce_button( array $buttons ): array {
		$buttons[] = 'mavo_picture';
		return $buttons;
	}

	/** Point TinyMCE to our JS plugin file. */
	public function register_tinymce_plugin( array $plugins ): array {
		$plugins['mavo_picture'] = MAVO_PICTURE_TAG_URL . 'js/mavo-picture-plugin.js?ver=' . MAVO_PICTURE_TAG_VERSION;
		return $plugins;
	}

	/* ------------------------------------------------------------------ */
	/*  Admin asset enqueue                                                 */
	/* ------------------------------------------------------------------ */

	public function enqueue_editor_assets( string $hook ): void {
		if ( ! in_array( $hook, [ 'post.php', 'post-new.php' ], true ) ) {
			return;
		}

		// Make sure wp.media is loaded.
		wp_enqueue_media();

		// Shared config object (mavoPicture) used by both the TinyMCE plugin
		// and the Quicktags script. We attach it to a thin inline-only handle.
		wp_register_script(
			'mavo-picture-plugin-data',
			false,   // no URL – inline-only handle
			[ 'jquery', 'media-editor' ],
			MAVO_PICTURE_TAG_VERSION,
			true
		);
		wp_enqueue_script( 'mavo-picture-plugin-data' );

		$i18n = [
			'buttonTitle'    => __( 'Insert Picture Tag', 'mavo-picture-tag' ),
			'buttonTitleEdit'=> __( 'Edit Picture Tag',   'mavo-picture-tag' ),
			'dialogTitle'    => __( 'Insert Picture Tag', 'mavo-picture-tag' ),
			'mediaTitle'     => __( 'Select Image',       'mavo-picture-tag' ),
			'mediaButton'    => __( 'Use this image',     'mavo-picture-tag' ),
			'insertBtn'      => __( 'Insert Picture',     'mavo-picture-tag' ),
			'cancelBtn'      => __( 'Cancel',             'mavo-picture-tag' ),
			'changeImg'      => __( 'Change Image',       'mavo-picture-tag' ),
			'addSource'      => __( '+ Add source',       'mavo-picture-tag' ),
			'removeSource'   => __( '− Remove last',      'mavo-picture-tag' ),
			'noSizes'        => __( 'No sizes found for this attachment.', 'mavo-picture-tag' ),
		];

		wp_localize_script(
			'mavo-picture-plugin-data',
			'mavoPicture',
			[
				'ajaxUrl' => admin_url( 'admin-ajax.php' ),
				'nonce'   => wp_create_nonce( 'mavo_picture_nonce' ),
				'i18n'    => $i18n,
			]
		);

		// Quicktags button – loaded for the Text/HTML editor tab.
		wp_enqueue_script(
			'mavo-quicktags',
			MAVO_PICTURE_TAG_URL . 'js/mavo-quicktags.js',
			[ 'jquery', 'quicktags', 'media-editor', 'mavo-picture-plugin-data' ],
			MAVO_PICTURE_TAG_VERSION,
			true
		);
	}

	/* ------------------------------------------------------------------ */
	/*  Admin CSS: fix TinyMCE dialog background + Quicktags modal styles  */
	/* ------------------------------------------------------------------ */

	public function output_admin_css(): void {
		$screen = get_current_screen();
		if ( ! $screen || ! in_array( $screen->id, [ 'post', 'page' ], true ) ) {
			return;
		}
		?>
		<style id="mavo-picture-tag-css">
		/* ── TinyMCE dialog: white background for the body area only.
		   Intentionally NOT targeting .mce-window .mce-container globally,
		   which would paint button backgrounds white too. ── */
		.mce-window-body,
		.mce-window-body .mce-abs-layout-item,
		.mce-window-body .mce-container-body {
			background-color: #fff !important;
		}

		/* ── Quicktags modal overlay ── */
		#mavo-qt-overlay {
			position: fixed;
			inset: 0;
			background: rgba(0,0,0,.55);
			z-index: 160000;
			display: flex;
			align-items: center;
			justify-content: center;
		}
		#mavo-qt-dialog {
			background: #fff;
			border-radius: 4px;
			box-shadow: 0 5px 30px rgba(0,0,0,.35);
			width: 560px;
			max-width: calc(100vw - 40px);
			max-height: 85vh;
			display: flex;
			flex-direction: column;
			font-size: 13px;
		}
		#mavo-qt-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 12px 16px;
			border-bottom: 1px solid #ddd;
			background: #f6f7f7;
			border-radius: 4px 4px 0 0;
		}
		#mavo-qt-body {
			padding: 16px;
			overflow-y: auto;
			flex: 1;
		}
		#mavo-qt-footer {
			display: flex;
			justify-content: flex-end;
			gap: 8px;
			padding: 12px 16px;
			border-top: 1px solid #ddd;
			background: #f6f7f7;
			border-radius: 0 0 4px 4px;
		}
		</style>
		<?php
	}

	/* ------------------------------------------------------------------ */
	/*  AJAX: get all image sizes for an attachment                        */
	/* ------------------------------------------------------------------ */

	public function ajax_get_attachment_sizes(): void {
		check_ajax_referer( 'mavo_picture_nonce', 'nonce' );

		$attachment_id = isset( $_POST['attachment_id'] ) ? absint( $_POST['attachment_id'] ) : 0;

		if ( ! $attachment_id || 'attachment' !== get_post_type( $attachment_id ) ) {
			wp_send_json_error( [ 'message' => 'Invalid attachment.' ] );
		}

		$meta       = wp_get_attachment_metadata( $attachment_id );
		$upload_dir = wp_upload_dir();
		$base_url   = $upload_dir['baseurl'];
		$base_dir   = $upload_dir['basedir'];
		$sizes      = [];

		// Derive the upload sub-directory (e.g. "2026/03") from the full-size
		// file path stored in metadata.  All size filenames live in this same dir.
		$full_file = $meta['file'] ?? '';                     // e.g. "2026/03/IMG_1987.jpeg"
		$sub_dir   = $full_file ? dirname( $full_file ) : ''; // e.g. "2026/03"

		// Strategy 1: read sizes from attachment metadata (most reliable when available).
		// Builds URLs from stored filenames to bypass CDN filters (e.g. Jetpack PhotoCDN)
		// that may rewrite wp_get_attachment_image_src() to the same origin URL for all sizes.
		foreach ( $meta['sizes'] ?? [] as $size_name => $size_meta ) {
			$rel = '/' . $sub_dir . '/' . $size_meta['file'];  // "/2026/03/IMG_1987-480x360.jpeg"
			$sizes[ $size_name ] = [
				'url'    => $base_url . $rel,
				'width'  => $size_meta['width'],
				'height' => $size_meta['height'],
				'webp'   => $this->get_webp_url( $size_name, $meta, $base_url, $base_dir, $rel ),
				'label'  => ucfirst( str_replace( '-', ' ', $size_name ) )
					. ' (' . $size_meta['width'] . '×' . $size_meta['height'] . ')',
			];
		}

		// Strategy 2: filesystem scan fallback for images whose intermediate sizes were
		// not recorded in WP metadata (e.g. uploaded via FTP, or resized by a plugin
		// that doesn't write to wp_postmeta).  Looks for basename-WxH.ext files on disk.
		if ( empty( $sizes ) && $full_file ) {
			$base_name = pathinfo( $full_file, PATHINFO_FILENAME ); // "IMG_1987"
			$ext       = pathinfo( $full_file, PATHINFO_EXTENSION ); // "jpeg"
			$abs_dir   = $base_dir . '/' . $sub_dir;
			$pattern   = $abs_dir . '/' . $base_name . '-[0-9]*x[0-9]*.' . $ext;

			foreach ( glob( $pattern ) ?: [] as $file_path ) {
				$filename = basename( $file_path );
				if ( ! preg_match( '/-(\d+)x(\d+)\.' . preg_quote( $ext, '/' ) . '$/', $filename, $m ) ) {
					continue;
				}
				$w         = (int) $m[1];
				$h         = (int) $m[2];
				$size_name = $w . 'x' . $h;
				$rel       = '/' . $sub_dir . '/' . $filename;
				$sizes[ $size_name ] = [
					'url'    => $base_url . $rel,
					'width'  => $w,
					'height' => $h,
					'webp'   => $this->get_webp_url( $size_name, $meta, $base_url, $base_dir, $rel ),
					'label'  => $w . '×' . $h . 'px',
				];
			}
		}

		// Full (original) size.
		if ( $full_file ) {
			$rel = '/' . $full_file;
			$sizes['full'] = [
				'url'    => $base_url . $rel,
				'width'  => $meta['width']  ?? 0,
				'height' => $meta['height'] ?? 0,
				'webp'   => $this->get_webp_url( 'full', $meta, $base_url, $base_dir, $rel ),
				'label'  => 'Full (' . ( $meta['width'] ?? 0 ) . '×' . ( $meta['height'] ?? 0 ) . ')',
			];
		}

		// Sort by width descending so the dialog auto-picks sensible breakpoints.
		uasort( $sizes, static fn( $a, $b ) => $b['width'] <=> $a['width'] );

		wp_send_json_success( [ 'sizes' => $sizes ] );
	}

	/* ------------------------------------------------------------------ */
	/*  Helpers                                                             */
	/* ------------------------------------------------------------------ */

	/**
	 * Try to resolve a WebP URL for a given size.
	 *
	 * Accepts the already-computed relative path (e.g. "/2026/03/IMG_1987-480x360.jpeg")
	 * so that no CDN-affected WordPress functions are called internally.
	 *
	 * Supports:
	 *  1. WordPress 6.1+ native multi-MIME sources stored in attachment meta.
	 *  2. Filesystem checks using two common WebP naming conventions.
	 *
	 * @param string $size_name  Registered size name or 'full'.
	 * @param array  $meta       wp_get_attachment_metadata() result.
	 * @param string $base_url   Uploads base URL (no trailing slash).
	 * @param string $base_dir   Uploads base directory (no trailing slash).
	 * @param string $relative   Relative path to the source file, e.g. "/2026/03/IMG.jpeg".
	 * @return string|null  WebP URL, or null when none found.
	 */
	private function get_webp_url( string $size_name, array $meta, string $base_url, string $base_dir, string $relative ): ?string {

		// 1. WordPress 6.1+ stores alternate MIME sources under 'sources'.
		//    Structure: $meta['sizes'][$size]['sources']['image/webp']['url']
		//    or         $meta['sources']['image/webp']['file'] (for 'full').
		$sub_dir = $meta['file'] ? dirname( $meta['file'] ) : '';

		if ( 'full' === $size_name ) {
			$webp_file = $meta['sources']['image/webp']['file'] ?? null;
			if ( $webp_file ) {
				return $base_url . '/' . $sub_dir . '/' . $webp_file;
			}
		} else {
			$webp_val = $meta['sizes'][ $size_name ]['sources']['image/webp']['url']
				?? ( $meta['sizes'][ $size_name ]['sources']['image/webp']['file'] ?? null );

			if ( $webp_val ) {
				if ( str_starts_with( $webp_val, 'http' ) ) {
					return $webp_val;
				}
				// It's a bare filename — resolve using the known sub-directory.
				return $base_url . '/' . $sub_dir . '/' . $webp_val;
			}
		}

		// 2. Filesystem checks using the known relative path.

		// 2a. Appended extension: IMG_1987-480x360.jpeg → IMG_1987-480x360.jpeg.webp
		//     (used by WebP Express and similar plugins).
		if ( file_exists( $base_dir . $relative . '.webp' ) ) {
			return $base_url . $relative . '.webp';
		}

		// 2b. Extension swap: IMG_1987-480x360.jpeg → IMG_1987-480x360.webp
		$swapped = preg_replace( '/\.[^.\/]+$/', '.webp', $relative );
		if ( file_exists( $base_dir . $swapped ) ) {
			return $base_url . $swapped;
		}

		return null;
	}

	/** Is the Classic Editor plugin active? */
	private function classic_editor_active(): bool {
		return is_plugin_active( 'classic-editor/classic-editor.php' );
	}
}
