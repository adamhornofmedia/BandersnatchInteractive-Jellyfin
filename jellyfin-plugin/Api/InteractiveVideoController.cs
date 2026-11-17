using System;
using System.ComponentModel.DataAnnotations;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.InteractiveVideo.Api
{
    /// <summary>
    /// Serves the full original Bandersnatch interactive player (joric/CyberShadow/mehotkhan)
    /// with the video streamed from Jellyfin. Static files live in the "web" folder next to the DLL.
    /// </summary>
    [ApiController]
    [Route("InteractiveVideo")]
    public class InteractiveVideoController : ControllerBase
    {
        private static readonly Regex ItemIdRegex = new("^[0-9a-fA-F-]{32,36}$", RegexOptions.Compiled);

        private readonly ILogger<InteractiveVideoController> _logger;

        /// <summary>
        /// Initializes a new instance of the <see cref="InteractiveVideoController"/> class.
        /// </summary>
        /// <param name="logger">Logger.</param>
        public InteractiveVideoController(ILogger<InteractiveVideoController> logger)
        {
            _logger = logger;
        }

        private static string WebRoot =>
            Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)!, "web");

        /// <summary>
        /// Gets the interactive player page.
        /// </summary>
        /// <param name="itemId">The media item ID.</param>
        /// <returns>HTML page.</returns>
        [HttpGet("Player/{itemId}")]
        [AllowAnonymous]
        public ActionResult GetPlayerPage([FromRoute, Required] string itemId)
        {
            if (!ItemIdRegex.IsMatch(itemId))
            {
                return BadRequest("Invalid item id");
            }

            var indexPath = Path.Combine(WebRoot, "index.html");
            if (!System.IO.File.Exists(indexPath))
            {
                _logger.LogError("Interactive player index.html not found at {Path}", indexPath);
                return NotFound("Player page not found");
            }

            var html = System.IO.File.ReadAllText(indexPath);
            var streamUrl = $"/Videos/{itemId}/stream?static=true&mediaSourceId={itemId}";
            html = html.Replace("<source id=\"video-source\" src=\"\">", $"<source id=\"video-source\" src=\"{streamUrl}\" type=\"video/mp4\">", StringComparison.Ordinal);
            html = html.Replace("src=\"assets/", "src=\"/InteractiveVideo/Web/assets/", StringComparison.Ordinal);
            html = html.Replace("href=\"assets/", "href=\"/InteractiveVideo/Web/assets/", StringComparison.Ordinal);
            html = html.Replace("src=\"subtitle/", "src=\"/InteractiveVideo/Web/subtitle/", StringComparison.Ordinal);

            return Content(html, "text/html; charset=utf-8");
        }

        /// <summary>
        /// Serves static player files (scripts, styles, subtitles).
        /// </summary>
        /// <param name="path">Relative path inside the web folder.</param>
        /// <returns>The file.</returns>
        [HttpGet("Web/{**path}")]
        [AllowAnonymous]
        public ActionResult GetWebFile([FromRoute, Required] string path)
        {
            var root = Path.GetFullPath(WebRoot) + Path.DirectorySeparatorChar;
            var full = Path.GetFullPath(Path.Combine(root, path.Replace('/', Path.DirectorySeparatorChar)));
            if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(full))
            {
                return NotFound();
            }

            var contentType = Path.GetExtension(full).ToLowerInvariant() switch
            {
                ".js" => "application/javascript; charset=utf-8",
                ".css" => "text/css; charset=utf-8",
                ".vtt" => "text/vtt; charset=utf-8",
                ".html" => "text/html; charset=utf-8",
                _ => "application/octet-stream"
            };

            return PhysicalFile(full, contentType);
        }
    }
}
