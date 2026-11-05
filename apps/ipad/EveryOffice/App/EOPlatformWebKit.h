#import <Foundation/Foundation.h>
#import <WebKit/WebKit.h>

NS_ASSUME_NONNULL_BEGIN

// Use WebKit's Objective-C entry points so iOS runtimes do not need the newer
// libswiftWebKit overlay for PDF configuration or Result-based callbacks.
@interface EOPlatformWebKit : NSObject

+ (void)createPDFInWebView:(WKWebView *)webView
                    rect:(CGRect)rect
              completion:(void (^)(NSData * _Nullable data, NSError * _Nullable error))completion
    NS_SWIFT_NAME(createPDF(in:rect:completion:));

+ (void)evaluateAsyncInWebView:(WKWebView *)webView
                        body:(NSString *)body
                   arguments:(NSDictionary<NSString *, id> *)arguments
                  completion:(void (^)(id _Nullable value, NSError * _Nullable error))completion
    NS_SWIFT_NAME(evaluateAsync(in:body:arguments:completion:));

@end

NS_ASSUME_NONNULL_END
