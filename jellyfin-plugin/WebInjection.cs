using System;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.InteractiveVideo
{
    /// <summary>
    /// Payload passed by the File Transformation plugin to the callback.
    /// </summary>
    public class TransformPayload
    {
        /// <summary>
        /// Gets or sets the file contents.
        /// </summary>
        public string? Contents { get; set; }
    }

    /// <summary>
    /// File Transformation callback that injects the Bandersnatch script into jellyfin-web's index.html.
    /// </summary>
    public static class IndexTransformer
    {
        private const string Tag = "<script src=\"/InteractiveVideo/Web/jf-bandersnatch.js\" defer></script>";

        /// <summary>
        /// Transforms index.html.
        /// </summary>
        /// <param name="payload">Payload with the current contents.</param>
        /// <returns>New contents.</returns>
        public static string Transform(TransformPayload payload)
        {
            string html = payload.Contents ?? string.Empty;
            if (html.Contains(Tag, StringComparison.Ordinal))
            {
                return html;
            }

            int idx = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
            return idx >= 0 ? html.Insert(idx, Tag) : html + Tag;
        }
    }

    /// <summary>
    /// Registers the hosted service.
    /// </summary>
    public class ServiceRegistrator : IPluginServiceRegistrator
    {
        /// <inheritdoc />
        public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
        {
            serviceCollection.AddHostedService<WebInjectionService>();
        }
    }

    /// <summary>
    /// Registers the index.html transformation with the File Transformation plugin on startup.
    /// </summary>
    public class WebInjectionService : IHostedService
    {
        private readonly ILogger<WebInjectionService> _logger;

        /// <summary>
        /// Initializes a new instance of the <see cref="WebInjectionService"/> class.
        /// </summary>
        /// <param name="logger">Logger.</param>
        public WebInjectionService(ILogger<WebInjectionService> logger)
        {
            _logger = logger;
        }

        /// <inheritdoc />
        public Task StartAsync(CancellationToken cancellationToken)
        {
            try
            {
                Assembly? ft = AssemblyLoadContext.All.SelectMany(x => x.Assemblies)
                    .FirstOrDefault(x => x.FullName?.Contains(".FileTransformation", StringComparison.Ordinal) ?? false);
                MethodInfo? register = ft?.GetType("Jellyfin.Plugin.FileTransformation.PluginInterface")?.GetMethod("RegisterTransformation");
                if (register == null)
                {
                    _logger.LogWarning("[InteractiveVideo] File Transformation plugin not found; web player integration disabled");
                    return Task.CompletedTask;
                }

                // Build the JObject with the exact Newtonsoft type File Transformation expects.
                Type jobjectType = register.GetParameters()[0].ParameterType;
                MethodInfo parse = jobjectType.GetMethod("Parse", new[] { typeof(string) })!;
                string json = "{"
                    + "\"id\":\"9b1f0b8e-4c55-4d0e-9f3a-bd5c1a7e2f10\","
                    + "\"fileNamePattern\":\"index.html\","
                    + "\"callbackAssembly\":" + System.Text.Json.JsonSerializer.Serialize(typeof(IndexTransformer).Assembly.FullName) + ","
                    + "\"callbackClass\":\"" + typeof(IndexTransformer).FullName + "\","
                    + "\"callbackMethod\":\"" + nameof(IndexTransformer.Transform) + "\""
                    + "}";
                object payload = parse.Invoke(null, new object[] { json })!;
                register.Invoke(null, new[] { payload });
                _logger.LogInformation("[InteractiveVideo] Registered index.html transformation (Bandersnatch web player integration)");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[InteractiveVideo] Failed to register web transformation");
            }

            return Task.CompletedTask;
        }

        /// <inheritdoc />
        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
