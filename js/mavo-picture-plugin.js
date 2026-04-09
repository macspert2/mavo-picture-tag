/**
 * Mavo Picture Tag – TinyMCE 4 plugin
 *
 * Adds a toolbar button that lets the editor pick an image from the
 * WordPress Media Library and wraps it in a fully-responsive <picture>
 * element (WebP sources first, JPEG/PNG fallback, lazy-loaded <img>).
 *
 * The dialog lets the editor:
 *  - Change the selected image.
 *  - Edit alt text (pre-filled from the media library).
 *  - Configure up to N responsive <source> breakpoints (auto-populated
 *    from all registered WordPress image sizes for that attachment).
 *  - Choose the fallback <img> size.
 *  - Toggle lazy loading and an optional <figure>/<figcaption> wrapper.
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
		var currentSizes   = {};
		/** Attachment data from wp.media for the current dialog session. */
		var currentAttach  = null;
		/** Tracks dynamic source rows in the dialog. */
		var sourceRows     = [];
		/** Reference to the open TinyMCE window (if any). */
		var dialogWin      = null;
		/** Whether we are editing an existing node. */
		var editingNode    = null;

		/* ---------------------------------------------------------------- */
		/*  Toolbar button                                                   */
		/* ---------------------------------------------------------------- */

		editor.addButton( 'mavo_picture', {
			title : i18n.buttonTitle,
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
			var node   = e.element;
			var pic    = findPictureAncestor( node );
			var btn    = editor.buttons && editor.buttons.mavo_picture;

			editingNode = pic || null;

			if ( btn ) {
				btn.title = pic ? i18n.buttonTitleEdit : i18n.buttonTitle;
			}
		} );

		/* ---------------------------------------------------------------- */
		/*  Step 1 – open WP Media Library                                  */
		/* ---------------------------------------------------------------- */

		function openMediaLibrary( prefillAttachmentId ) {
			var frame = wp.media( {
				title    : i18n.mediaTitle,
				button   : { text: i18n.mediaButton },
				multiple : false,
				library  : { type: 'image' }
			} );

			if ( prefillAttachmentId ) {
				frame.on( 'open', function () {
					var selection = frame.state().get( 'selection' );
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
					if ( response.success ) {
						callback( response.data.sizes );
					} else {
						callback( {} );
					}
				}
			).fail( function () {
				callback( {} );
			} );
		}

		/* ---------------------------------------------------------------- */
		/*  Step 3 – open the configuration dialog                          */
		/* ---------------------------------------------------------------- */

		/**
		 * Build and open the TinyMCE 4 dialog.
		 *
		 * @param {Object}      attachment  wp.media attachment JSON.
		 * @param {Object}      sizes       AJAX sizes response.
		 * @param {HTMLElement|null} existingNode  Existing <picture>/<figure> for edit mode.
		 */
		function openDialog( attachment, sizes, existingNode ) {
			currentAttach = attachment;
			currentSizes  = sizes;
			sourceRows    = [];

			var sizeNames  = Object.keys( sizes );
			if ( ! sizeNames.length ) {
				editor.windowManager.alert( i18n.noSizes );
				return;
			}

			/* Build <select> options list for image sizes. */
			var sizeOptions = sizeNames.map( function ( key ) {
				return { text: sizes[ key ].label, value: key };
			} );

			/* Auto-select default sources: up to 3 largest non-full sizes. */
			var defaultSources = sizeNames
				.filter( function ( k ) { return k !== 'full'; } )
				.slice( 0, 3 );

			/* If editing, parse existing sources from the DOM. */
			var prefill = existingNode ? parsePictureNode( existingNode, sizes ) : null;

			/* Build the initial source rows HTML. */
			var sourcesToRender = prefill ? prefill.sources : defaultSources.map( function ( k, idx ) {
				var breakpoints = [ 960, 768, 480 ];
				return { sizeName: k, minWidth: breakpoints[ idx ] || ( 480 - idx * 100 ) };
			} );

			var sourcesHtml = buildSourceRowsHtml( sourcesToRender, sizeOptions, sizes );

			/* Fallback img size: smallest non-full size, or prefilled value. */
			var fallbackSize = prefill
				? prefill.fallbackSize
				: sizeNames.filter( function ( k ) { return k !== 'full'; } ).pop() || sizeNames[ 0 ];

			/* Open dialog ------------------------------------------------- */
			dialogWin = editor.windowManager.open( {
				title  : i18n.dialogTitle,
				width  : 560,
				height : 'auto',
				body   : [
					/* ── Image selection ── */
					{
						type  : 'container',
						html  :
							'<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">' +
							'  <img id="mavo-preview" src="' + esc( attachment.url ) + '" ' +
							'       style="max-width:80px;max-height:60px;object-fit:contain;border:1px solid #ddd;border-radius:3px;">' +
							'  <button id="mavo-change-img" class="button">' + esc( i18n.changeImg ) + '</button>' +
							'</div>'
					},

					/* ── Alt text ── */
					{
						type      : 'textbox',
						name      : 'altText',
						label     : 'Alt text',
						value     : prefill ? prefill.alt : ( attachment.alt || attachment.title || '' ),
						multiline : false,
						style     : 'width:100%'
					},

					/* ── Responsive sources ── */
					{
						type : 'container',
						html :
							'<p style="margin:12px 0 4px;font-weight:600;">Responsive sources ' +
							'<span style="font-weight:400;font-size:11px;color:#666;">' +
							'(largest breakpoint first)</span></p>' +
							'<div id="mavo-sources-wrap" style="margin-bottom:4px;">' +
							sourcesHtml +
							'</div>' +
							'<div style="display:flex;gap:8px;margin-bottom:12px;">' +
							'  <button id="mavo-add-source" class="button button-small">' + esc( i18n.addSource ) + '</button>' +
							'  <button id="mavo-remove-source" class="button button-small">' + esc( i18n.removeSource ) + '</button>' +
							'</div>'
					},

					/* ── Fallback <img> size ── */
					{
						type    : 'listbox',
						name    : 'fallbackSize',
						label   : 'Fallback <img> size',
						values  : sizeOptions,
						value   : fallbackSize
					},

					/* ── Options ── */
					{
						type  : 'container',
						html  :
							'<div style="display:flex;gap:24px;margin:8px 0;">' +
							'  <label><input type="checkbox" id="mavo-lazy" ' +
							( ( prefill && ! prefill.lazy ) ? '' : 'checked' ) +
							'> Lazy loading</label>' +
							'  <label><input type="checkbox" id="mavo-figure" ' +
							( ( prefill && ! prefill.useFigure ) ? '' : 'checked' ) +
							'> Wrap in &lt;figure&gt;</label>' +
							'</div>'
					},

					/* ── Caption (shown only when figure is checked) ── */
					{
						type  : 'textbox',
						name  : 'caption',
						label : 'Caption',
						value : prefill ? ( prefill.caption || '' ) : ''
					}
				],

				buttons: [
					{
						text    : i18n.cancelBtn,
						onclick : function () { dialogWin.close(); }
					},
					{
						text    : i18n.insertBtn,
						subtype : 'primary',
						onclick : function () {
							onInsert( dialogWin );
						}
					}
				],

				onopen: function () {
					bindDialogEvents( sizeOptions, sizes, sourcesToRender );
					/* Sync internal sourceRows from initial HTML. */
					sourceRows = sourcesToRender.map( function ( s ) {
						return { sizeName: s.sizeName, minWidth: s.minWidth };
					} );
				}
			} );
		}

		/* ---------------------------------------------------------------- */
		/*  Dialog event bindings                                            */
		/* ---------------------------------------------------------------- */

		function bindDialogEvents( sizeOptions, sizes, initialRows ) {
			var $body = $( 'div[role="dialog"]:visible' );

			/* Change image button. */
			$body.on( 'click', '#mavo-change-img', function () {
				dialogWin.close();
				openMediaLibrary( currentAttach && currentAttach.id );
			} );

			/* Add source row. */
			$body.on( 'click', '#mavo-add-source', function () {
				var nextWidth = 320;
				if ( sourceRows.length ) {
					var last = sourceRows[ sourceRows.length - 1 ].minWidth;
					nextWidth = Math.max( 100, last - 160 );
				}
				var newRow = { sizeName: sizeOptions[ sizeOptions.length - 1 ].value, minWidth: nextWidth };
				sourceRows.push( newRow );
				$body.find( '#mavo-sources-wrap' ).append( buildSourceRowHtml( newRow, sizeOptions, sizes, sourceRows.length - 1 ) );
			} );

			/* Remove last source row. */
			$body.on( 'click', '#mavo-remove-source', function () {
				if ( sourceRows.length <= 1 ) return;
				sourceRows.pop();
				$body.find( '.mavo-source-row' ).last().remove();
			} );
		}

		/* ---------------------------------------------------------------- */
		/*  Collect dialog values and insert HTML                            */
		/* ---------------------------------------------------------------- */

		function onInsert( win ) {
			var data = win.toJSON();

			/* Collect source rows from the live DOM. */
			var $rows  = $( 'div[role="dialog"]:visible .mavo-source-row' );
			var sources = [];
			$rows.each( function () {
				var $row     = $( this );
				var minWidth = parseInt( $row.find( '.mavo-bp-width' ).val(), 10 ) || 0;
				var sizeName = $row.find( '.mavo-bp-size' ).val();
				if ( sizeName && minWidth > 0 ) {
					sources.push( { sizeName: sizeName, minWidth: minWidth } );
				}
			} );

			/* Sort largest breakpoint first. */
			sources.sort( function ( a, b ) { return b.minWidth - a.minWidth; } );

			var $dlg     = $( 'div[role="dialog"]:visible' );
			var lazy     = $dlg.find( '#mavo-lazy' ).is( ':checked' );
			var useFigure= $dlg.find( '#mavo-figure' ).is( ':checked' );

			var html = buildPictureHTML( {
				sources      : sources,
				sizes        : currentSizes,
				fallbackSize : data.fallbackSize,
				alt          : data.altText || '',
				caption      : data.caption || '',
				lazy         : lazy,
				useFigure    : useFigure
			} );

			win.close();

			if ( editingNode ) {
				/* Replace existing node. */
				var $existing = $( editingNode );
				$existing.replaceWith( html );
				editor.fire( 'change' );
			} else {
				editor.insertContent( html );
			}

			editingNode = null;
		}

		/* ---------------------------------------------------------------- */
		/*  HTML builder                                                     */
		/* ---------------------------------------------------------------- */

		/**
		 * Build the final <picture> markup.
		 *
		 * @param {Object} opts
		 * @param {Array}  opts.sources       [{sizeName, minWidth}] sorted desc.
		 * @param {Object} opts.sizes         AJAX sizes map.
		 * @param {string} opts.fallbackSize  Key in sizes to use for <img>.
		 * @param {string} opts.alt
		 * @param {string} opts.caption
		 * @param {boolean} opts.lazy
		 * @param {boolean} opts.useFigure
		 */
		function buildPictureHTML( opts ) {
			var lines  = [];
			var indent = opts.useFigure ? '\t\t' : '\t';

			lines.push( opts.useFigure ? '<figure class="wp-picture-figure">' : '' );
			lines.push( ( opts.useFigure ? '\t' : '' ) + '<picture>' );

			opts.sources.forEach( function ( s ) {
				var sizeData = opts.sizes[ s.sizeName ];
				if ( ! sizeData ) return;

				var media = '(min-width: ' + s.minWidth + 'px)';

				/* WebP source first (if available). */
				if ( sizeData.webp ) {
					lines.push(
						indent +
						'<source type="image/webp"' +
						' media="' + media + '"' +
						' srcset="' + esc( sizeData.webp ) + '">'
					);
				}

				/* JPEG/PNG source. */
				lines.push(
					indent +
					'<source' +
					' media="' + media + '"' +
					' srcset="' + esc( sizeData.url ) + '">'
				);
			} );

			/* Fallback <img>. */
			var fallback = opts.sizes[ opts.fallbackSize ] || Object.values( opts.sizes ).pop();
			if ( fallback ) {
				var imgAttrs = [
					'src="' + esc( fallback.url ) + '"',
					'alt="' + esc( opts.alt ) + '"',
					'width="' + fallback.width + '"',
					'height="' + fallback.height + '"'
				];
				if ( opts.lazy ) {
					imgAttrs.push( 'loading="lazy"' );
				}
				lines.push( indent + '<img ' + imgAttrs.join( ' ' ) + '>' );
			}

			lines.push( ( opts.useFigure ? '\t' : '' ) + '</picture>' );

			if ( opts.useFigure && opts.caption ) {
				lines.push( '\t<figcaption>' + esc( opts.caption ) + '</figcaption>' );
			}

			if ( opts.useFigure ) {
				lines.push( '</figure>' );
			}

			return lines.filter( function ( l ) { return l !== ''; } ).join( '\n' );
		}

		/* ---------------------------------------------------------------- */
		/*  Edit existing <picture>                                          */
		/* ---------------------------------------------------------------- */

		function reopenForEdit( node ) {
			/* Try to extract the attachment ID from the fallback <img> src. */
			var $pic    = $( node ).is( 'picture' ) ? $( node ) : $( node ).find( 'picture' );
			var imgSrc  = $pic.find( 'img' ).attr( 'src' ) || '';

			/* We don't have the attachment ID directly; show media library
			   pre-open on the current image so the user confirms/changes it. */
			var parsed = parsePictureNode( node );

			/* Fetch sizes for the attachment. We need the attachment ID.
			   As a fallback we open the media library with an explanatory title. */
			var frame = wp.media( {
				title    : i18n.buttonTitleEdit,
				button   : { text: i18n.mediaButton },
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
		 *
		 * @param {HTMLElement} node
		 * @param {Object}      [sizes]  Optional sizes map to match URLs.
		 */
		function parsePictureNode( node, sizes ) {
			var $node    = $( node );
			var $pic     = $node.is( 'picture' ) ? $node : $node.find( 'picture' ).first();
			var $img     = $pic.find( 'img' ).first();
			var $sources = $pic.find( 'source' );

			var alt        = $img.attr( 'alt' ) || '';
			var lazy       = $img.attr( 'loading' ) === 'lazy';
			var useFigure  = $node.is( 'figure' );
			var caption    = useFigure ? $node.find( 'figcaption' ).text() : '';
			var fallbackSrc= $img.attr( 'src' ) || '';

			/* Build sources list: pair WebP + non-WebP sources by media query. */
			var seenMedia = {};
			$sources.each( function () {
				var $src    = $( this );
				var media   = $src.attr( 'media' ) || '';
				var type    = $src.attr( 'type' ) || '';
				var isWebP  = type === 'image/webp';
				var minW    = parseInt( ( media.match( /min-width:\s*(\d+)/ ) || [] )[ 1 ], 10 ) || 0;

				if ( ! isWebP ) {
					// Non-webp source defines a row.
					if ( ! seenMedia[ minW ] ) {
						seenMedia[ minW ] = { minWidth: minW, sizeName: matchSizeByUrl( $src.attr( 'srcset' ), sizes ) };
					}
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
				fallbackSize : matchSizeByUrl( fallbackSrc, sizes )
			};
		}

		/** Find the size key whose URL matches a given src string. */
		function matchSizeByUrl( url, sizes ) {
			if ( ! url || ! sizes ) return '';
			var found = Object.keys( sizes ).find( function ( k ) {
				return sizes[ k ].url === url;
			} );
			return found || '';
		}

		/* ---------------------------------------------------------------- */
		/*  DOM helpers                                                      */
		/* ---------------------------------------------------------------- */

		/** Walk up the DOM to find an ancestor that is <picture> or <figure> with <picture>. */
		function findPictureAncestor( node ) {
			while ( node && node.nodeName !== 'BODY' ) {
				if ( node.nodeName === 'PICTURE' ) return node;
				if ( node.nodeName === 'FIGURE' && node.querySelector( 'picture' ) ) return node;
				node = node.parentNode;
			}
			return null;
		}

		/* ---------------------------------------------------------------- */
		/*  Source row HTML                                                  */
		/* ---------------------------------------------------------------- */

		function buildSourceRowsHtml( rows, sizeOptions, sizes ) {
			return rows.map( function ( row, idx ) {
				return buildSourceRowHtml( row, sizeOptions, sizes, idx );
			} ).join( '' );
		}

		function buildSourceRowHtml( row, sizeOptions, sizes, idx ) {
			var selectHtml = sizeOptions.map( function ( opt ) {
				return '<option value="' + esc( opt.value ) + '"' +
					( opt.value === row.sizeName ? ' selected' : '' ) +
					'>' + esc( opt.text ) + '</option>';
			} ).join( '' );

			/* Indicator dot: green if this size has WebP, grey if not. */
			var hasWebp = row.sizeName && sizes[ row.sizeName ] && sizes[ row.sizeName ].webp;
			var dot = hasWebp
				? '<span title="WebP available" style="color:#4caf50;font-size:16px;">●</span>'
				: '<span title="No WebP found"  style="color:#ccc;font-size:16px;">●</span>';

			return (
				'<div class="mavo-source-row" style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
				'  <span style="font-size:12px;color:#666;">≥</span>' +
				'  <input class="mavo-bp-width" type="number" value="' + ( row.minWidth || 960 ) + '" min="1" max="9999"' +
				'         style="width:70px;" title="Min viewport width (px)">' +
				'  <span style="font-size:12px;color:#666;">px →</span>' +
				'  <select class="mavo-bp-size" style="flex:1;">' + selectHtml + '</select>' +
				'  ' + dot +
				'</div>'
			);
		}

		/* ---------------------------------------------------------------- */
		/*  Tiny HTML escaping utility                                       */
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
