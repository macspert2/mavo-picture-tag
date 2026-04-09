/**
 * Mavo Picture Tag – TinyMCE 4 plugin
 *
 * Adds a toolbar button that lets the editor pick an image from the
 * WordPress Media Library and wraps it in a fully-responsive <picture>
 * element (WebP sources first, JPEG/PNG fallback, lazy-loaded <img>).
 *
 * The dialog is a custom jQuery overlay appended directly to <body> —
 * identical to the Quicktags dialog — so TinyMCE's HTML sanitisation
 * never interferes with <select> defaults or other form state.
 *
 * Clicking an existing <picture> (or its <figure> parent) in the editor
 * re-opens the dialog pre-filled with the current values.
 */
/* global tinymce, mavoPicture, wp, jQuery */
( function ( $, i18n ) {
	'use strict';

	/* ------------------------------------------------------------------ */
	/*  SVG icon (picture-frame with mountain & sun)                       */
	/* ------------------------------------------------------------------ */

	var ICON_SVG =
		'data:image/svg+xml;charset=UTF-8,' +
		encodeURIComponent(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
			'<rect x="1" y="3" width="18" height="14" rx="2" ry="2" ' +
			'      fill="none" stroke="#555" stroke-width="1.5"/>' +
			'<circle cx="6.5" cy="7.5" r="1.5" fill="#f0a500"/>' +
			'<polyline points="1,16 6,10 10,14 13,11 19,16" ' +
			'          fill="none" stroke="#555" stroke-width="1.5" stroke-linejoin="round"/>' +
			'</svg>'
		);

	/* ------------------------------------------------------------------ */
	/*  Plugin registration                                                 */
	/* ------------------------------------------------------------------ */

	tinymce.PluginManager.add( 'mavo_picture', function ( editor ) {

		/** Currently cached sizes from the last AJAX call. */
		var currentSizes  = {};
		/** Attachment data from wp.media for the current dialog session. */
		var currentAttach = null;
		/** Tracks dynamic source rows in the dialog. */
		var sourceRows    = [];
		/** Size options list (shared across add/remove handlers). */
		var sizeOptions   = [];
		/** Whether we are editing an existing node. */
		var editingNode   = null;

		/* ---------------------------------------------------------------- */
		/*  Toolbar button                                                   */
		/* ---------------------------------------------------------------- */

		editor.addButton( 'mavo_picture', {
			title : i18n.buttonTitle || 'Insert Picture Tag',
			image : ICON_SVG,
			onclick: function () {
				if ( editingNode ) {
					reopenForEdit( editingNode );
				} else {
					openMediaLibrary();
				}
			}
		} );

		/* ---------------------------------------------------------------- */
		/*  Context: detect existing <picture> when cursor moves            */
		/* ---------------------------------------------------------------- */

		editor.on( 'NodeChange', function ( e ) {
			var node = e.element;
			var pic  = findPictureAncestor( node );
			var btn  = editor.buttons && editor.buttons.mavo_picture;

			editingNode = pic || null;

			if ( btn ) {
				btn.title = pic
					? ( i18n.buttonTitleEdit || 'Edit Picture Tag' )
					: ( i18n.buttonTitle     || 'Insert Picture Tag' );
			}
		} );

		/* ---------------------------------------------------------------- */
		/*  Step 1 – open WP Media Library                                  */
		/* ---------------------------------------------------------------- */

		function openMediaLibrary( prefillAttachmentId ) {
			var frame = wp.media( {
				title    : i18n.mediaTitle   || 'Select Image',
				button   : { text: i18n.mediaButton || 'Use this image' },
				multiple : false,
				library  : { type: 'image' }
			} );

			if ( prefillAttachmentId ) {
				frame.on( 'open', function () {
					var selection  = frame.state().get( 'selection' );
					var attachment = wp.media.attachment( prefillAttachmentId );
					attachment.fetch();
					selection.add( attachment );
				} );
			}

			frame.on( 'select', function () {
				var attachment = frame.state().get( 'selection' ).first().toJSON();
				fetchSizes( attachment.id, function ( sizes ) {
					openDialog( attachment, sizes, null );
				} );
			} );

			frame.open();
		}

		/* ---------------------------------------------------------------- */
		/*  Step 2 – fetch all image sizes via AJAX                         */
		/* ---------------------------------------------------------------- */

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

		/* ---------------------------------------------------------------- */
		/*  Step 3 – open the configuration dialog                          */
		/* ---------------------------------------------------------------- */

		/**
		 * Build and open the custom jQuery overlay dialog.
		 * Uses the same #mavo-qt-* structure as mavo-quicktags.js so that
		 * the shared CSS (output via admin_head) handles all styling.
		 *
		 * @param {Object}           attachment   wp.media attachment JSON.
		 * @param {Object}           sizes        AJAX sizes response.
		 * @param {HTMLElement|null} existingNode Existing <picture>/<figure> for edit.
		 */
		function openDialog( attachment, sizes, existingNode ) {
			currentAttach = attachment;
			currentSizes  = sizes;
			sourceRows    = [];

			var sizeNames = Object.keys( sizes );
			if ( ! sizeNames.length ) {
				// eslint-disable-next-line no-alert
				window.alert( i18n.noSizes || 'No sizes found for this attachment.' );
				return;
			}

			sizeOptions = sizeNames.map( function ( k ) {
				return { value: k, text: sizes[ k ].label };
			} );

			/* Parse existing node (edit mode) or set up defaults (insert mode). */
			var prefill = existingNode ? parsePictureNode( existingNode, sizes ) : null;

			var defaultSources = sizeNames
				.filter( function ( k ) { return k !== 'full'; } )
				.slice( 0, 3 )
				.map( function ( k, idx ) {
					return { sizeName: k, minWidth: [ 960, 768, 480 ][ idx ] || ( 480 - idx * 100 ) };
				} );

			var sourcesToRender = prefill ? prefill.sources : defaultSources;
			sourceRows = sourcesToRender.slice();

			var fallbackSize = prefill
				? prefill.fallbackSize
				: pickDefaultFallback( sizes, sizeNames );

			var initAlt     = prefill ? prefill.alt     : ( attachment.alt || attachment.title || '' );
			var initCaption = prefill ? ( prefill.caption || '' ) : '';
			var initLazy    = prefill ? prefill.lazy    : true;
			var initFigure  = prefill ? prefill.useFigure : true;

			var $overlay = buildModal(
				attachment, sizes,
				sourcesToRender, fallbackSize,
				initAlt, initCaption, initLazy, initFigure
			);

			$( 'body' ).append( $overlay );
			bindModalEvents( $overlay, sizes, existingNode );
		}

		/* ---------------------------------------------------------------- */
		/*  Build modal HTML                                                 */
		/* ---------------------------------------------------------------- */

		function buildModal( attachment, sizes, sourcesToRender, fallbackSize, initAlt, initCaption, initLazy, initFigure ) {

			var selectOpts = sizeOptions.map( function ( o ) {
				return '<option value="' + esc( o.value ) + '"' +
					( o.value === fallbackSize ? ' selected' : '' ) +
					'>' + esc( o.text ) + '</option>';
			} ).join( '' );

			var sourcesHtml = sourcesToRender.map( function ( row ) {
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
				'<input type="text" id="mavo-qt-alt" value="' + esc( initAlt ) +
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
				'<label><input type="checkbox" id="mavo-qt-lazy"' + ( initLazy ? ' checked' : '' ) + '> Lazy loading</label>' +
				'<label><input type="checkbox" id="mavo-qt-figure"' + ( initFigure ? ' checked' : '' ) + '> Wrap in &lt;figure&gt;</label>' +
				'</div>' +

				/* Caption */
				'<label style="display:block;margin-bottom:0;">' +
				'<span style="display:block;font-weight:600;margin-bottom:3px;">Caption</span>' +
				'<input type="text" id="mavo-qt-caption" value="' + esc( initCaption ) +
				'" style="width:100%;box-sizing:border-box;">' +
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

		/* ---------------------------------------------------------------- */
		/*  Modal event bindings                                             */
		/* ---------------------------------------------------------------- */

		function bindModalEvents( $overlay, sizes, existingNode ) {

			/* Close on backdrop click or × button. */
			$overlay.on( 'click', '#mavo-qt-overlay', function ( e ) {
				if ( $( e.target ).is( '#mavo-qt-overlay' ) ) { $overlay.remove(); }
			} );
			$overlay.on( 'click', '#mavo-qt-close, .mavo-qt-cancel', function () {
				$overlay.remove();
			} );

			/* Change image. */
			$overlay.on( 'click', '#mavo-qt-change-img', function () {
				$overlay.remove();
				openMediaLibrary( currentAttach && currentAttach.id );
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
				if ( sourceRows.length <= 1 ) { return; }
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

				if ( existingNode ) {
					$( existingNode ).replaceWith( html );
					editor.fire( 'change' );
					editingNode = null;
				} else {
					editor.insertContent( html );
				}
			} );
		}

		/* ---------------------------------------------------------------- */
		/*  Source row HTML                                                  */
		/* ---------------------------------------------------------------- */

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

		/* ---------------------------------------------------------------- */
		/*  HTML builder                                                     */
		/* ---------------------------------------------------------------- */

		function buildPictureHTML( opts ) {
			var lines  = [];
			var indent = opts.useFigure ? '\t\t' : '\t';

			if ( opts.useFigure ) { lines.push( '<figure class="wp-picture-figure">' ); }
			lines.push( ( opts.useFigure ? '\t' : '' ) + '<picture>' );

			/* Skip any source whose URL resolves to the full-size file
			   (WordPress silent fallback when no resized copy exists). */
			var fullUrl = opts.sizes['full'] ? opts.sizes['full'].url : null;

			opts.sources.forEach( function ( s ) {
				var sizeData = opts.sizes[ s.sizeName ];
				if ( ! sizeData ) { return; }
				if ( fullUrl && sizeData.url === fullUrl ) { return; }

				var media = '(min-width: ' + s.minWidth + 'px)';

				if ( sizeData.webp ) {
					lines.push( indent + '<source type="image/webp" media="' + media + '" srcset="' + esc( sizeData.webp ) + '">' );
				}
				lines.push( indent + '<source media="' + media + '" srcset="' + esc( sizeData.url ) + '">' );
			} );

			var fallback = opts.sizes[ opts.fallbackSize ] || Object.values( opts.sizes ).pop();
			if ( fallback ) {
				var attrs = [
					'src="'    + esc( fallback.url )    + '"',
					'alt="'    + esc( opts.alt )        + '"',
					'width="'  + fallback.width         + '"',
					'height="' + fallback.height        + '"'
				];
				if ( opts.lazy ) { attrs.push( 'loading="lazy"' ); }
				lines.push( indent + '<img ' + attrs.join( ' ' ) + '>' );
			}

			lines.push( ( opts.useFigure ? '\t' : '' ) + '</picture>' );

			if ( opts.useFigure && opts.caption ) {
				lines.push( '\t<figcaption>' + esc( opts.caption ) + '</figcaption>' );
			}
			if ( opts.useFigure ) { lines.push( '</figure>' ); }

			return lines.join( '\n' );
		}

		/* ---------------------------------------------------------------- */
		/*  Edit existing <picture>                                          */
		/* ---------------------------------------------------------------- */

		function reopenForEdit( node ) {
			var frame = wp.media( {
				title    : i18n.buttonTitleEdit || 'Edit Picture Tag',
				button   : { text: i18n.mediaButton || 'Use this image' },
				multiple : false,
				library  : { type: 'image' }
			} );

			frame.on( 'select', function () {
				var attachment = frame.state().get( 'selection' ).first().toJSON();
				fetchSizes( attachment.id, function ( sizes ) {
					openDialog( attachment, sizes, node );
				} );
			} );

			frame.open();
		}

		/**
		 * Parse an existing <picture> (or its <figure>) into dialog prefill data.
		 */
		function parsePictureNode( node, sizes ) {
			var $node    = $( node );
			var $pic     = $node.is( 'picture' ) ? $node : $node.find( 'picture' ).first();
			var $img     = $pic.find( 'img' ).first();
			var $sources = $pic.find( 'source' );

			var alt       = $img.attr( 'alt' )     || '';
			var lazy      = $img.attr( 'loading' ) === 'lazy';
			var useFigure = $node.is( 'figure' );
			var caption   = useFigure ? $node.find( 'figcaption' ).text() : '';

			var seenMedia = {};
			$sources.each( function () {
				var $src   = $( this );
				var media  = $src.attr( 'media' ) || '';
				var type   = $src.attr( 'type' )  || '';
				var isWebP = ( type === 'image/webp' );
				var minW   = parseInt( ( media.match( /min-width:\s*(\d+)/ ) || [] )[ 1 ], 10 ) || 0;

				if ( ! isWebP && ! seenMedia[ minW ] ) {
					seenMedia[ minW ] = {
						minWidth : minW,
						sizeName : matchSizeByUrl( $src.attr( 'srcset' ), sizes )
					};
				}
			} );

			var parsedSources = Object.values( seenMedia ).sort( function ( a, b ) {
				return b.minWidth - a.minWidth;
			} );

			return {
				alt          : alt,
				lazy         : lazy,
				useFigure    : useFigure,
				caption      : caption,
				sources      : parsedSources.length ? parsedSources : [ { minWidth: 960, sizeName: '' } ],
				fallbackSize : matchSizeByUrl( $img.attr( 'src' ) || '', sizes )
			};
		}

		function matchSizeByUrl( url, sizes ) {
			if ( ! url || ! sizes ) { return ''; }
			var found = Object.keys( sizes ).find( function ( k ) {
				return sizes[ k ].url === url;
			} );
			return found || '';
		}

		/* ---------------------------------------------------------------- */
		/*  Default fallback size selection                                  */
		/* ---------------------------------------------------------------- */

		function pickDefaultFallback( sizes, sizeNames ) {
			var nonFull = sizeNames.filter( function ( k ) { return k !== 'full'; } );
			if ( ! nonFull.length ) { return sizeNames[ 0 ] || ''; }
			if ( sizes.large ) { return 'large'; }
			var target = 960;
			return nonFull.reduce( function ( best, curr ) {
				return Math.abs( sizes[ curr ].width - target ) <
				       Math.abs( sizes[ best ].width - target ) ? curr : best;
			}, nonFull[ 0 ] );
		}

		/* ---------------------------------------------------------------- */
		/*  DOM helpers                                                      */
		/* ---------------------------------------------------------------- */

		function findPictureAncestor( node ) {
			while ( node && node.nodeName !== 'BODY' ) {
				if ( node.nodeName === 'PICTURE' ) { return node; }
				if ( node.nodeName === 'FIGURE' && node.querySelector( 'picture' ) ) { return node; }
				node = node.parentNode;
			}
			return null;
		}

		/* ---------------------------------------------------------------- */
		/*  HTML escaping                                                    */
		/* ---------------------------------------------------------------- */

		function esc( str ) {
			return String( str )
				.replace( /&/g, '&amp;' )
				.replace( /"/g, '&quot;' )
				.replace( /</g, '&lt;' )
				.replace( />/g, '&gt;' );
		}

	} );

} )( jQuery, ( typeof mavoPicture !== 'undefined' && mavoPicture.i18n ) ? mavoPicture.i18n : {} );
