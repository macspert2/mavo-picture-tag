/**
 * Mavo Picture Tag – Quicktags (Text/HTML editor) button
 *
 * Registers a "Picture" button in the Text/HTML tab of the Classic Editor.
 * Clicking it opens the WordPress Media Library, then a custom white-
 * background modal dialog where the editor configures the responsive
 * <picture> sources, then inserts the generated HTML at the cursor.
 */
/* global mavoPicture, wp, jQuery, QTags */
( function ( $ ) {
	'use strict';

	if ( typeof QTags === 'undefined' || typeof wp === 'undefined' ) {
		return;
	}

	var i18n = ( typeof mavoPicture !== 'undefined' && mavoPicture.i18n )
		? mavoPicture.i18n
		: {};

	/** State for the current dialog session. */
	var currentSizes  = {};
	var currentAttach = null;
	var sourceRows    = [];
	var sizeOptions   = [];
	/** Reference to the active QTags canvas (textarea). */
	var activeCanvas  = null;

	/* ------------------------------------------------------------------ */
	/*  Register Quicktags button                                           */
	/* ------------------------------------------------------------------ */

	QTags.addButton(
		'mavo_picture',
		'Picture',
		function ( element, canvas ) {
			activeCanvas = canvas;
			openMediaLibrary();
		},
		'',   // close tag (unused – using callback)
		'',   // access key
		i18n.buttonTitle || 'Insert Picture Tag',
		999   // position (far right)
	);

	/* ------------------------------------------------------------------ */
	/*  Step 1 – open WP Media Library                                     */
	/* ------------------------------------------------------------------ */

	function openMediaLibrary() {
		var frame = wp.media( {
			title    : i18n.mediaTitle   || 'Select Image',
			button   : { text: i18n.mediaButton || 'Use this image' },
			multiple : false,
			library  : { type: 'image' }
		} );

		frame.on( 'select', function () {
			var attachment = frame.state().get( 'selection' ).first().toJSON();
			fetchSizes( attachment.id, function ( sizes ) {
				openDialog( attachment, sizes );
			} );
		} );

		frame.open();
	}

	/* ------------------------------------------------------------------ */
	/*  Step 2 – fetch all image sizes via AJAX                            */
	/* ------------------------------------------------------------------ */

	function fetchSizes( attachmentId, callback ) {
		$.post(
			mavoPicture.ajaxUrl,
			{
				action        : 'mavo_get_attachment_sizes',
				attachment_id : attachmentId,
				nonce         : mavoPicture.nonce
			},
			function ( response ) {
				callback( response.success ? response.data.sizes : {} );
			}
		).fail( function () { callback( {} ); } );
	}

	/* ------------------------------------------------------------------ */
	/*  Step 3 – open the configuration modal                              */
	/* ------------------------------------------------------------------ */

	function openDialog( attachment, sizes ) {
		currentAttach = attachment;
		currentSizes  = sizes;
		sourceRows    = [];

		var names = Object.keys( sizes );
		if ( ! names.length ) {
			// eslint-disable-next-line no-alert
			window.alert( i18n.noSizes || 'No sizes found for this attachment.' );
			return;
		}

		sizeOptions = names.map( function ( k ) {
			return { value: k, text: sizes[ k ].label };
		} );

		/* Default sources: full at 960, then sizes closest to 640 and 480. */
		var nonFull = names.filter( function ( k ) { return k !== 'full'; } );
		var closestSize = function ( target ) {
			if ( ! nonFull.length ) { return ''; }
			return nonFull.reduce( function ( best, curr ) {
				return Math.abs( sizes[ curr ].width - target ) <
				       Math.abs( sizes[ best ].width - target ) ? curr : best;
			}, nonFull[ 0 ] );
		};
		var defaultSources = [
			{ sizeName: 'full',             minWidth: 960 },
			{ sizeName: closestSize( 640 ), minWidth: 640 },
			{ sizeName: closestSize( 480 ), minWidth: 480 }
		].filter( function ( s ) { return s.sizeName && sizes[ s.sizeName ]; } );

		sourceRows = defaultSources.slice();

		var fallbackSize = pickDefaultFallback( sizes, names );

		var $overlay = buildModal( attachment, sizes, defaultSources, fallbackSize );
		$( 'body' ).append( $overlay );

		bindModalEvents( $overlay, sizes );
	}

	/* ------------------------------------------------------------------ */
	/*  Build modal HTML                                                    */
	/* ------------------------------------------------------------------ */

	function buildModal( attachment, sizes, defaultSources, fallbackSize ) {
		var selectOpts = sizeOptions.map( function ( o ) {
			return '<option value="' + esc( o.value ) + '"' +
				( o.value === fallbackSize ? ' selected' : '' ) +
				'>' + esc( o.text ) + '</option>';
		} ).join( '' );

		var sourcesHtml = defaultSources.map( function ( row ) {
			return buildSourceRowHtml( row, sizes );
		} ).join( '' );

		var html =
			'<div id="mavo-qt-overlay" role="dialog" aria-modal="true">' +
			'<div id="mavo-qt-dialog">' +

			/* Header */
			'<div id="mavo-qt-header">' +
			'<h3 style="margin:0;font-size:14px;">' + esc( i18n.dialogTitle || 'Insert Picture Tag' ) + '</h3>' +
			'<button id="mavo-qt-close" type="button" aria-label="Close" ' +
			'        style="background:none;border:none;font-size:20px;cursor:pointer;line-height:1;padding:0;">×</button>' +
			'</div>' +

			/* Body */
			'<div id="mavo-qt-body">' +

			/* Image preview + change button */
			'<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">' +
			'<img id="mavo-qt-preview" src="' + esc( attachment.url ) + '" ' +
			'     style="max-width:80px;max-height:60px;object-fit:contain;border:1px solid #ddd;border-radius:3px;">' +
			'<button type="button" id="mavo-qt-change-img" class="button">' +
			esc( i18n.changeImg || 'Change Image' ) + '</button>' +
			'</div>' +

			/* Alt text */
			'<label style="display:block;margin-bottom:10px;">' +
			'<span style="display:block;font-weight:600;margin-bottom:3px;">Alt text</span>' +
			'<input type="text" id="mavo-qt-alt" value="' +
			esc( attachment.alt || attachment.title || '' ) +
			'" style="width:100%;box-sizing:border-box;">' +
			'</label>' +

			/* Sources */
			'<p style="margin:0 0 4px;font-weight:600;">Responsive sources ' +
			'<span style="font-weight:400;font-size:11px;color:#666;">(largest breakpoint first)</span></p>' +
			'<div id="mavo-qt-sources-wrap" style="margin-bottom:4px;">' + sourcesHtml + '</div>' +
			'<div style="display:flex;gap:8px;margin-bottom:12px;">' +
			'<button type="button" id="mavo-qt-add-source" class="button button-small">' +
			esc( i18n.addSource || '+ Add source' ) + '</button>' +
			'<button type="button" id="mavo-qt-remove-source" class="button button-small">' +
			esc( i18n.removeSource || '− Remove last' ) + '</button>' +
			'</div>' +

			/* Fallback size */
			'<label style="display:block;margin-bottom:10px;">' +
			'<span style="display:block;font-weight:600;margin-bottom:3px;">Fallback &lt;img&gt; size</span>' +
			'<select id="mavo-qt-fallback" style="width:100%;">' + selectOpts + '</select>' +
			'</label>' +

			/* Options */
			'<div style="display:flex;gap:24px;margin-bottom:10px;">' +
			'<label><input type="checkbox" id="mavo-qt-lazy" checked> Lazy loading</label>' +
			'<label><input type="checkbox" id="mavo-qt-figure" checked> Wrap in &lt;figure&gt;</label>' +
			'</div>' +

			/* Caption */
			'<label style="display:block;margin-bottom:0;">' +
			'<span style="display:block;font-weight:600;margin-bottom:3px;">Caption</span>' +
			'<input type="text" id="mavo-qt-caption" value="" style="width:100%;box-sizing:border-box;">' +
			'</label>' +

			'</div>' + /* end #mavo-qt-body */

			/* Footer */
			'<div id="mavo-qt-footer">' +
			'<button type="button" class="button mavo-qt-cancel">' +
			esc( i18n.cancelBtn || 'Cancel' ) + '</button>' +
			'<button type="button" class="button button-primary" id="mavo-qt-insert">' +
			esc( i18n.insertBtn || 'Insert Picture' ) + '</button>' +
			'</div>' +

			'</div>' + /* end #mavo-qt-dialog */
			'</div>';  /* end #mavo-qt-overlay */

		return $( html );
	}

	/* ------------------------------------------------------------------ */
	/*  Modal event bindings                                                */
	/* ------------------------------------------------------------------ */

	function bindModalEvents( $overlay, sizes ) {

		/* Close on overlay click or × button. */
		$overlay.on( 'click', '#mavo-qt-overlay', function ( e ) {
			if ( $( e.target ).is( '#mavo-qt-overlay' ) ) $overlay.remove();
		} );
		$overlay.on( 'click', '#mavo-qt-close, .mavo-qt-cancel', function () {
			$overlay.remove();
		} );

		/* Change image. */
		$overlay.on( 'click', '#mavo-qt-change-img', function () {
			$overlay.remove();
			openMediaLibrary();
		} );

		/* Add source row. */
		$overlay.on( 'click', '#mavo-qt-add-source', function () {
			var nextWidth = 320;
			if ( sourceRows.length ) {
				nextWidth = Math.max( 100, sourceRows[ sourceRows.length - 1 ].minWidth - 160 );
			}
			var row = { sizeName: sizeOptions[ sizeOptions.length - 1 ].value, minWidth: nextWidth };
			sourceRows.push( row );
			$overlay.find( '#mavo-qt-sources-wrap' ).append( buildSourceRowHtml( row, sizes ) );
		} );

		/* Remove last source row. */
		$overlay.on( 'click', '#mavo-qt-remove-source', function () {
			if ( sourceRows.length <= 1 ) return;
			sourceRows.pop();
			$overlay.find( '.mavo-qt-source-row' ).last().remove();
		} );

		/* Insert. */
		$overlay.on( 'click', '#mavo-qt-insert', function () {
			var sources = [];
			$overlay.find( '.mavo-qt-source-row' ).each( function () {
				var minWidth = parseInt( $( this ).find( '.mavo-qt-bp-width' ).val(), 10 ) || 0;
				var sizeName = $( this ).find( '.mavo-qt-bp-size' ).val();
				if ( sizeName && minWidth > 0 ) {
					sources.push( { sizeName: sizeName, minWidth: minWidth } );
				}
			} );
			sources.sort( function ( a, b ) { return b.minWidth - a.minWidth; } );

			var html = buildPictureHTML( {
				sources      : sources,
				sizes        : currentSizes,
				fallbackSize : $overlay.find( '#mavo-qt-fallback' ).val(),
				alt          : $overlay.find( '#mavo-qt-alt' ).val(),
				caption      : $overlay.find( '#mavo-qt-caption' ).val(),
				lazy         : $overlay.find( '#mavo-qt-lazy' ).is( ':checked' ),
				useFigure    : $overlay.find( '#mavo-qt-figure' ).is( ':checked' )
			} );

			$overlay.remove();
			QTags.insertContent( html );
		} );
	}

	/* ------------------------------------------------------------------ */
	/*  Source row HTML                                                     */
	/* ------------------------------------------------------------------ */

	function buildSourceRowHtml( row, sizes ) {
		var selectHtml = sizeOptions.map( function ( opt ) {
			return '<option value="' + esc( opt.value ) + '"' +
				( opt.value === row.sizeName ? ' selected' : '' ) +
				'>' + esc( opt.text ) + '</option>';
		} ).join( '' );

		var hasWebp = row.sizeName && sizes[ row.sizeName ] && sizes[ row.sizeName ].webp;
		var dot = hasWebp
			? '<span title="WebP available" style="color:#4caf50;font-size:16px;">●</span>'
			: '<span title="No WebP found"  style="color:#ccc;font-size:16px;">●</span>';

		return (
			'<div class="mavo-qt-source-row" style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
			'<span style="font-size:12px;color:#666;">≥</span>' +
			'<input class="mavo-qt-bp-width" type="number" value="' + ( row.minWidth || 960 ) +
			'" min="1" max="9999" style="width:70px;" title="Min viewport width (px)">' +
			'<span style="font-size:12px;color:#666;">px →</span>' +
			'<select class="mavo-qt-bp-size" style="flex:1;">' + selectHtml + '</select>' +
			dot +
			'</div>'
		);
	}

	/* ------------------------------------------------------------------ */
	/*  HTML builder (mirrors mavo-picture-plugin.js)                      */
	/* ------------------------------------------------------------------ */

	function buildPictureHTML( opts ) {
		var lines  = [];
		var indent = opts.useFigure ? '\t\t' : '\t';

		if ( opts.useFigure ) lines.push( '<figure class="wp-picture-figure">' );
		lines.push( ( opts.useFigure ? '\t' : '' ) + '<picture>' );

		opts.sources.forEach( function ( s ) {
			var sizeData = opts.sizes[ s.sizeName ];
			if ( ! sizeData ) return;
			var media = '(min-width: ' + s.minWidth + 'px)';
			if ( sizeData.webp ) {
				lines.push( indent + '<source type="image/webp" media="' + media + '" srcset="' + esc( sizeData.webp ) + '">' );
			}
			lines.push( indent + '<source media="' + media + '" srcset="' + esc( sizeData.url ) + '">' );
		} );

		var fallback = opts.sizes[ opts.fallbackSize ] || Object.values( opts.sizes ).pop();
		if ( fallback ) {
			/* Bare WebP source (no media query) catches all viewports not
			   matched above and serves WebP to capable browsers, while the
			   <img> below remains the JPEG fallback for everyone else. */
			if ( fallback.webp ) {
				lines.push( indent + '<source type="image/webp" srcset="' + esc( fallback.webp ) + '">' );
			}
			var attrs = [
				'src="' + esc( fallback.url ) + '"',
				'alt="' + esc( opts.alt ) + '"',
				'width="' + fallback.width + '"',
				'height="' + fallback.height + '"'
			];
			if ( opts.lazy ) attrs.push( 'loading="lazy"' );
			lines.push( indent + '<img ' + attrs.join( ' ' ) + '>' );
		}

		lines.push( ( opts.useFigure ? '\t' : '' ) + '</picture>' );
		if ( opts.useFigure && opts.caption ) {
			lines.push( '\t<figcaption>' + esc( opts.caption ) + '</figcaption>' );
		}
		if ( opts.useFigure ) lines.push( '</figure>' );

		return lines.join( '\n' );
	}

	/* ------------------------------------------------------------------ */
	/*  Default fallback size selection                                     */
	/* ------------------------------------------------------------------ */

	function pickDefaultFallback( sizes, sizeNames ) {
		var nonFull = sizeNames.filter( function ( k ) { return k !== 'full'; } );
		if ( ! nonFull.length ) return sizeNames[ 0 ] || '';
		var target = 480;
		return nonFull.reduce( function ( best, curr ) {
			return Math.abs( sizes[ curr ].width - target ) <
			       Math.abs( sizes[ best ].width - target ) ? curr : best;
		}, nonFull[ 0 ] );
	}

	/* ------------------------------------------------------------------ */
	/*  HTML escaping                                                       */
	/* ------------------------------------------------------------------ */

	function esc( str ) {
		return String( str )
			.replace( /&/g, '&amp;' )
			.replace( /"/g, '&quot;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' );
	}

} )( jQuery );
