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
		$plugins['mavo_picture'] = MAVO_PICTURE_TAG_URL . 'js/mavo-picture-plugin.js';
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

		// Register a thin handle so we can attach localized data to it.
		// The actual TinyMCE plugin JS is loaded by TinyMCE itself via
		// mce_external_plugins; this handle is only used for wp_localize_script.
		wp_register_script(
			'mavo-picture-plugin-data',
			false,   // no URL – inline-only handle
			[ 'jquery', 'media-editor' ],
			MAVO_PICTURE_TAG_VERSION,
			true
		);
		wp_enqueue_script( 'mavo-picture-plugin-data' );

		wp_localize_script(
			'mavo-picture-plugin-data',
			'mavoPicture',
			[
				'ajaxUrl' => admin_url( 'admin-ajax.php' ),
				'nonce'   => wp_create_nonce( 'mavo_picture_nonce' ),
				'i18n'    => [
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
				],
			]
		);
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

		$meta   = wp_get_attachment_metadata( $attachment_id );
		$sizes  = [];

		// Collect every registered intermediate size.
		foreach ( get_intermediate_image_sizes() as $size_name ) {
			$src = wp_get_attachment_image_src( $attachment_id, $size_name );
			if ( ! $src ) {
				continue;
			}
			$sizes[ $size_name ] = [
				'url'     => $src[0],
				'width'   => $src[1],
				'height'  => $src[2],
				'webp'    => $this->get_webp_url( $attachment_id, $size_name, $meta ),
				'label'   => ucfirst( str_replace( '-', ' ', $size_name ) )
					. ' (' . $src[1] . '×' . $src[2] . ')',
			];
		}

		// Also include the full/original size.
		$full = wp_get_attachment_image_src( $attachment_id, 'full' );
		if ( $full ) {
			$sizes['full'] = [
				'url'    => $full[0],
				'width'  => $full[1],
				'height' => $full[2],
				'webp'   => $this->get_webp_url( $attachment_id, 'full', $meta ),
				'label'  => 'Full (' . $full[1] . '×' . $full[2] . ')',
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
	 * Try to resolve a WebP URL for a given attachment + size.
	 *
	 * Supports:
	 *  1. WordPress 6.1+ native multi-MIME sources stored in attachment meta.
	 *  2. A filesystem check: replace extension with .webp and verify the
	 *     file exists on disk (covers most WebP-conversion plugins).
	 *
	 * @param int    $attachment_id
	 * @param string $size_name  Registered size name or 'full'.
	 * @param array  $meta       wp_get_attachment_metadata() result.
	 * @return string|null  WebP URL, or null when none found.
	 */
	private function get_webp_url( int $attachment_id, string $size_name, array $meta ): ?string {

		// 1. WordPress 6.1+ stores alternate MIME sources under 'sources'.
		//    Structure: $meta['sizes'][$size]['sources']['image/webp']['url']
		//    or         $meta['sources']['image/webp']['file'] (for 'full').
		if ( 'full' === $size_name ) {
			$webp_file = $meta['sources']['image/webp']['file'] ?? null;
			if ( $webp_file ) {
				$upload_dir = wp_upload_dir();
				$year_month = isset( $meta['file'] )
					? implode( '/', array_slice( explode( '/', $meta['file'] ), 0, -1 ) )
					: '';
				return $upload_dir['baseurl'] . '/' . $year_month . '/' . $webp_file;
			}
		} else {
			$webp_url = $meta['sizes'][ $size_name ]['sources']['image/webp']['url']
				?? ( $meta['sizes'][ $size_name ]['sources']['image/webp']['file'] ?? null );

			if ( $webp_url ) {
				// If it's just a filename, resolve to full URL.
				if ( ! str_starts_with( $webp_url, 'http' ) ) {
					$src = wp_get_attachment_image_src( $attachment_id, $size_name );
					$webp_url = $src
						? preg_replace( '/\.[^.]+$/', '.webp', $src[0] )
						: null;
				}
				return $webp_url;
			}
		}

		// 2. Filesystem check: swap extension to .webp and see if it exists.
		$src = wp_get_attachment_image_src( $attachment_id, $size_name );
		if ( ! $src ) {
			return null;
		}

		$upload_dir  = wp_upload_dir();
		$relative    = str_replace( $upload_dir['baseurl'], '', $src[0] );
		$webp_rel    = preg_replace( '/\.[^.]+$/', '.webp', $relative );
		$webp_path   = $upload_dir['basedir'] . $webp_rel;

		if ( file_exists( $webp_path ) ) {
			return $upload_dir['baseurl'] . $webp_rel;
		}

		return null;
	}

	/** Is the Classic Editor plugin active? */
	private function classic_editor_active(): bool {
		return is_plugin_active( 'classic-editor/classic-editor.php' );
	}
}
