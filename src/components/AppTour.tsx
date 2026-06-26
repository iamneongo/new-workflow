'use client';

import React, { useCallback, useEffect, useRef } from 'react';

type AppTourProps = {
  selectedAutomationId: string | null;
  hasAutomations: boolean;
  isLoading: boolean;
  activeWorkflowNode: WorkflowNodeKey | null;
};

type WorkflowNodeKey = 'source' | 'approval' | 'reject' | 'supply' | 'supplyChange' | 'delivery' | 'final';

type TourStep = {
  element?: string;
  popover: {
    title: string;
    description: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
    popoverClass?: string;
    showButtons?: Array<'next' | 'previous' | 'close'>;
  };
  disableActiveInteraction?: boolean;
};

const TOUR_SEEN_KEY = 'telegram-bot-tracker-tour-seen-v1';

export default function AppTour({
  selectedAutomationId,
  hasAutomations,
  isLoading,
  activeWorkflowNode,
}: AppTourProps) {
  const driverRef = useRef<any>(null);
  const tourPhaseRef = useRef<'idle' | 'intro' | 'workflow' | 'done'>('idle');
  const tourNodeRef = useRef<WorkflowNodeKey | null>(null);

  const destroyTour = useCallback((markSeen: boolean) => {
    if (typeof window !== 'undefined') {
      if (markSeen) {
        window.localStorage.setItem(TOUR_SEEN_KEY, '1');
      }
    }

    if (driverRef.current) {
      driverRef.current.destroy();
      driverRef.current = null;
    }
    tourNodeRef.current = null;
    if (markSeen) {
      tourPhaseRef.current = 'done';
    }
  }, []);

  const pushStep = useCallback((steps: TourStep[], selector: string, step: Omit<TourStep, 'element'>) => {
    if (typeof document === 'undefined' || !document.querySelector(selector)) return;
    steps.push({ element: selector, ...step });
  }, []);

  const buildIntroSteps = useCallback((): TourStep[] => {
    const steps: TourStep[] = [];

    pushStep(steps, '#appBrand', {
      popover: {
        title: 'Bảng điều khiển',
        description: 'Đây là màn hình chính. Bạn tạo automation, đồng bộ dữ liệu và xem log ở đây.',
        side: 'bottom',
        align: 'start',
      },
    });

    pushStep(steps, '#btnBotConfig', {
      popover: {
        title: 'Token bot',
        description: 'Nhập token ở đây. Không có token thì bot không chạy.',
        side: 'bottom',
        align: 'start',
      },
    });

    pushStep(steps, '#btnSync', {
      popover: {
        title: 'Đồng bộ',
        description: 'Bấm khi bạn muốn kéo lại nhóm, chủ đề, và dữ liệu Telegram mới nhất.',
        side: 'bottom',
        align: 'start',
      },
    });

    pushStep(steps, '#btnLogout', {
      popover: {
        title: 'Đăng xuất',
        description: 'Xóa session hiện tại và buộc đăng nhập lại từ đầu.',
        side: 'bottom',
        align: 'start',
      },
    });

    pushStep(steps, '#runtimeLogToggle', {
      popover: {
        title: 'Runtime log',
        description: 'Bấm để mở phần log khi muốn xem bot đang dừng ở đâu, có lỗi gì hoặc xử lý chậm ở bước nào.',
        side: 'bottom',
        align: 'start',
      },
    });

    pushStep(steps, '#createAutomationButton', {
      popover: {
        title: 'Tạo automation',
        description: 'Mỗi công trình nên có một automation riêng.',
        side: 'right',
        align: 'start',
      },
    });

    pushStep(steps, '#searchInput', {
      popover: {
        title: 'Tìm nhanh',
        description: 'Gõ tên công trình để lọc automation trong danh sách.',
        side: 'right',
        align: 'start',
      },
    });

    if (hasAutomations) {
      pushStep(steps, '#automationList', {
        popover: {
          title: 'Danh sách automation',
          description: 'Chọn một automation ở đây để đi tiếp phần cấu hình.',
          side: 'right',
          align: 'start',
          showButtons: ['close'],
        },
      });
    }

    pushStep(steps, '#detailsSection', {
      popover: {
        title: 'Khu cấu hình',
        description: 'Phần này sẽ hiện tên automation, nút chạy, và toàn bộ sơ đồ.',
        side: 'left',
        align: 'start',
      },
    });

    return steps;
  }, [hasAutomations, pushStep]);

  const buildWorkflowSteps = useCallback((): TourStep[] => {
    const steps: TourStep[] = [];

    pushStep(steps, '#detailsSection', {
      popover: {
        title: 'Khu cấu hình',
        description: 'Đây là nơi bạn chỉnh từng node. Mỗi node đều bấm được, không phải chỉ để xem.',
        side: 'left',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-automation-name', {
      popover: {
        title: 'Đổi tên',
        description: 'Đặt tên theo công trình để khỏi nhầm khi có nhiều automation chạy song song.',
        side: 'bottom',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-listener-toggle', {
      popover: {
        title: 'Bật bot theo dõi',
        description: 'Chỉ bật khi token bot và nhóm nguồn đã xong. Nếu chưa đủ, bot sẽ không bắt đầu nghe tin.',
        side: 'bottom',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-workflow-canvas', {
      popover: {
        title: 'Sơ đồ quy trình',
        description: 'Kéo để di chuyển, zoom để nhìn rõ hơn, rồi bấm từng node để mở phần cấu hình chi tiết.',
        side: 'left',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-node-source', {
      popover: {
        title: 'Bước 1: Nhóm nguồn',
        description: 'Node này quyết định bot sẽ nghe ở đâu. Bấm vào để chọn nhóm nguồn và những chủ đề cần theo dõi.',
        side: 'right',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-node-approval', {
      popover: {
        title: 'Bước 2: Gửi sang nhóm duyệt',
        description: 'Node này chuyển tin sang nhóm duyệt. Tại đây bạn chọn nhóm, chủ đề, và cách gửi tin gốc.',
        side: 'right',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-node-reject', {
      popover: {
        title: 'Nhánh từ chối',
        description: 'Nhánh này dùng khi không đồng ý ở bước phê duyệt. Nó báo trạng thái sang nhóm đã chọn.',
        side: 'right',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-node-supply', {
      popover: {
        title: 'Bước 3: Chọn nhà cung ứng',
        description: 'Đây là nhánh hỏi nhà cung ứng. Ngoài nhóm nhận tin chính, bạn còn thêm từng nhà cung ứng ở bên dưới.',
        side: 'right',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-node-supply-change', {
      popover: {
        title: 'Nhánh báo đổi vật tư',
        description: 'Nếu nhà cung ứng không đồng ý hoặc muốn đổi vật tư, bot sẽ đi theo nhánh này để báo lại đúng nhóm bạn đã chọn.',
        side: 'right',
        align: 'start',
      },
    });
    pushStep(steps, '#tour-supply-change-editor', {
      popover: {
        title: 'Chọn nơi nhận báo đổi',
        description: 'Chọn nhóm và chủ đề sẽ nhận thông báo đổi vật tư, rồi chọn cách gửi lại nội dung.',
        side: 'top',
        align: 'start',
      },
    });
    pushStep(steps, '#tour-supply-change-message-mode', {
      popover: {
        title: 'Chọn cách gửi',
        description: 'Chọn gửi nguyên nếu muốn giữ nguyên tin gốc. Chọn sao chép nếu tin có ảnh, file, hoặc bạn muốn tạo một tin mới cho nhóm nhận.',
        side: 'top',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-node-delivery', {
      popover: {
        title: 'Bước 4: Báo đã nhận vật tư',
        description: 'Node này nhắc mọi người khi vật tư đang về công trình và chờ reply ngay trên tin nhắn đó.',
        side: 'right',
        align: 'start',
      },
    });

    pushStep(steps, '#tour-node-final', {
      popover: {
        title: 'Bước 5: Chốt nghiệm thu',
        description: 'Node cuối chốt quy trình, gửi phản hồi nghiệm thu sang nơi bạn đã chọn và ghi nhận số lượt xử lý.',
        side: 'right',
        align: 'start',
      },
    });

    return steps;
  }, [pushStep]);

  const buildNodeSteps = useCallback((node: WorkflowNodeKey): TourStep[] => {
    const steps: TourStep[] = [];

    if (node === 'source') {
      pushStep(steps, '#tour-node-source', {
        popover: {
          title: 'Bước 1: Nhóm nguồn',
          description: 'Chọn đúng nhóm nguồn là đủ để bot bắt đầu nghe. Nếu muốn theo dõi nhiều chủ đề, hãy tick nhiều mục cùng lúc.',
          side: 'right',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-source-editor', {
        popover: {
          title: 'Cách dùng node nguồn',
          description: 'Bấm vào ô nhóm để chọn nhóm hoặc kênh Telegram. Sau đó chọn một hoặc nhiều chủ đề. Nếu để trống chủ đề, bot sẽ nghe toàn bộ nhóm. Xong thì bấm Lưu.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-topic-multi-source', {
        popover: {
        title: 'Chọn nhiều chủ đề',
        description: 'Tick từng chủ đề bạn muốn nghe. Nút “Chọn tất cả” sẽ bật hết chủ đề trong nhóm, còn “Bỏ chọn” sẽ xóa sạch lựa chọn.',
          side: 'top',
          align: 'start',
        },
      });
    }

    if (node === 'approval') {
      pushStep(steps, '#tour-node-approval', {
        popover: {
          title: 'Bước 2: Gửi sang nhóm duyệt',
          description: 'Node này đẩy nội dung sang nhóm duyệt kèm nút xử lý. Đây là chỗ người dùng bấm Đồng ý hoặc Không đồng ý.',
          side: 'right',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-approval-editor', {
        popover: {
          title: 'Cách dùng node duyệt',
          description: 'Chọn nhóm và chủ đề nhận tin, rồi chọn cách gửi: forward giữ nguyên tin gốc, copy sẽ sao chép nguyên nội dung và media. Cuối cùng sửa lời nhắn nếu muốn.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-approval-message-mode', {
        popover: {
          title: 'Forward hay copy',
          description: 'Chọn forward nếu muốn giữ nguyên luồng gốc. Chọn copy nếu tin có ảnh, file, hoặc bạn muốn gửi lại như một tin mới.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-approval-custom-message', {
        popover: {
          title: 'Lời nhắn thêm',
          description: 'Đây là đoạn nhắn thêm lên đầu tin duyệt để người đọc hiểu cần làm gì. Có thể giữ mẫu mặc định hoặc viết ngắn gọn theo cách làm của bạn.',
          side: 'top',
          align: 'start',
        },
      });
    }

    if (node === 'reject') {
      pushStep(steps, '#tour-node-reject', {
        popover: {
          title: 'Nhánh từ chối',
          description: 'Dùng cho trường hợp không đồng ý ở bước duyệt sơ bộ. Nó chỉ báo về nhóm đã chọn, không đi tiếp sang nhà cung ứng.',
          side: 'right',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-reject-editor', {
        popover: {
          title: 'Cách dùng nhánh từ chối',
          description: 'Chọn nhóm và chủ đề nhận thông báo từ chối. Nếu nhóm có chủ đề, bạn nên chỉ định rõ để tránh tin rơi vào sai chỗ.',
          side: 'top',
          align: 'start',
        },
      });
    }

    if (node === 'supply') {
      pushStep(steps, '#tour-node-supply', {
        popover: {
          title: 'Bước 3: Chọn nhà cung ứng',
          description: 'Đây là node hỏi phương án cung cấp. Ngoài nhóm nhận tin chính, nó còn giữ danh sách nhà cung ứng cho từng công trình.',
          side: 'right',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-supply-editor', {
        popover: {
          title: 'Cách dùng node vật tư',
          description: 'Chọn nhóm nhận câu hỏi vật tư trước. Nếu công trình có nhiều nhà cung ứng, thêm từng nhà cung ứng ở phần bên dưới rồi chọn nhóm, chủ đề và cách gửi cho từng bên.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-supplier-route-1', {
        popover: {
          title: 'Nhà cung ứng đầu tiên',
          description: 'Trong từng thẻ, bạn đặt tên dễ nhớ, chọn nhóm và chủ đề nhận tin, rồi quyết định gửi nguyên hay sao chép. Làm xong thì bấm Lưu.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-supplier-route-name-1', {
        popover: {
          title: 'Đặt tên nhà cung ứng',
          description: 'Đặt một cái tên ngắn gọn, dễ nhìn để sau này biết ngay đây là bên nào.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-supplier-route-mode-1', {
        popover: {
          title: 'Chọn cách gửi',
          description: 'Chọn gửi nguyên nếu muốn giữ nguyên nội dung gốc. Chọn sao chép nếu muốn tin gửi sang bên nhà cung ứng trông như một tin mới.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-supplier-routes-section', {
        popover: {
          title: 'Danh sách nhà cung ứng',
          description: 'Mỗi nhà cung ứng là một đường gửi riêng. Bấm “Thêm nhà cung ứng”, đặt tên dễ nhớ, rồi gắn nhóm và chủ đề nhận tin cho đúng bên.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-add-supplier-route', {
        popover: {
          title: 'Thêm nhà cung ứng',
          description: 'Dùng nút này khi công trình có hơn một nhà cung ứng. Mỗi nhà cung ứng có thể gửi bằng gửi nguyên hoặc sao chép tùy cách bạn muốn giữ nội dung.',
          side: 'left',
          align: 'start',
        },
      });
    }

    if (node === 'supplyChange') {
      pushStep(steps, '#tour-node-supply-change', {
        popover: {
          title: 'Nhánh báo đổi vật tư',
          description: 'Node này dùng khi nhà cung ứng muốn đổi vật tư. Bấm vào để chọn nhóm nhận thông báo, rồi quyết định gửi nguyên hay sao chép.',
          side: 'right',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-supply-change-editor', {
        popover: {
          title: 'Cách dùng nhánh đổi vật tư',
          description: 'Chọn nhóm và chủ đề sẽ nhận thông báo đổi vật tư. Nếu bạn để đúng topic theo công trình, người xem sẽ biết cần xử lý ở đâu.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-supply-change-message-mode', {
        popover: {
          title: 'Chọn cách gửi',
          description: 'Chọn gửi nguyên nếu muốn giữ nguyên tin gốc. Chọn sao chép nếu tin có ảnh, file, hoặc bạn muốn tạo một tin mới cho nhóm nhận.',
          side: 'top',
          align: 'start',
        },
      });
    }

    if (node === 'delivery') {
      pushStep(steps, '#tour-node-delivery', {
        popover: {
          title: 'Bước 4: Báo đã nhận vật tư',
          description: 'Node này dùng khi vật tư đã được chở về công trình. Hệ thống sẽ gửi thông báo và chờ người dùng reply trực tiếp vào tin đó.',
          side: 'right',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-delivery-editor', {
        popover: {
          title: 'Cách dùng node giao nhận',
          description: 'Chọn nhóm và chủ đề sẽ nhận thông báo giao hàng. Nên để đúng chủ đề theo công trình để khi reply, bot biết phải ghi nhận vào đâu.',
          side: 'top',
          align: 'start',
        },
      });
    }

    if (node === 'final') {
      pushStep(steps, '#tour-node-final', {
        popover: {
          title: 'Bước 5: Chốt nghiệm thu',
          description: 'Đây là node chốt cuối. Khi có reply nghiệm thu, bot sẽ gửi phản hồi sang nơi bạn đã cấu hình.',
          side: 'right',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-final-editor', {
        popover: {
          title: 'Cách dùng node nghiệm thu',
          description: 'Chọn nhóm và chủ đề nhận kết quả cuối, rồi quyết định gửi bằng gửi nguyên hay sao chép. Nếu cần nhắn khác cho từng công trình, sửa lời nhắn ở đây trước khi lưu.',
          side: 'top',
          align: 'start',
        },
      });
      pushStep(steps, '#tour-final-message-mode', {
        popover: {
          title: 'Kiểu gửi kết quả cuối',
          description: 'Forward giữ nguyên reply gốc. Copy hữu ích nếu nội dung có ảnh, file hoặc bạn muốn gửi như một tin mới.',
          side: 'top',
          align: 'start',
        },
      });
    }

    pushStep(steps, `#tour-selector-actions-${node}`, {
      popover: {
        title: 'Lưu lại',
        description: 'Sau khi chỉnh xong, bấm Lưu để hệ thống ghi nhớ thay đổi. Nếu bot đang chạy, nó sẽ tự nạp lại cấu hình mới.',
        side: 'top',
        align: 'start',
      },
    });

    return steps;
  }, [pushStep]);

  const startNodeTour = useCallback(async (node: WorkflowNodeKey) => {
    if (typeof window === 'undefined') return;

    const steps = buildNodeSteps(node);
    if (!steps.length) return;

    const { driver } = await import('driver.js');

    if (driverRef.current) {
      driverRef.current.destroy();
      driverRef.current = null;
    }

    tourPhaseRef.current = 'workflow';
    tourNodeRef.current = node;

    const instance = driver({
      steps,
      animate: true,
      showProgress: true,
      overlayColor: '#111827',
      overlayOpacity: 0.58,
      smoothScroll: true,
      allowScroll: false,
      allowClose: true,
      allowKeyboardControl: true,
      stagePadding: 12,
      stageRadius: 18,
      popoverClass: 'app-tour-popover',
      nextBtnText: 'Tiếp',
      prevBtnText: 'Quay lại',
      doneBtnText: 'Xong',
      onHighlightStarted: (element) => {
        if (element instanceof HTMLElement) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      },
      onCloseClick: () => destroyTour(true),
      onDoneClick: () => destroyTour(true),
    });

    driverRef.current = instance;
    instance.drive();
  }, [buildNodeSteps, destroyTour]);

  const startTour = useCallback(async (phase: 'intro' | 'workflow') => {
    if (typeof window === 'undefined') return;

    const steps = phase === 'intro' ? buildIntroSteps() : buildWorkflowSteps();
    if (!steps.length) return;

    const { driver } = await import('driver.js');

    if (driverRef.current) {
      driverRef.current.destroy();
      driverRef.current = null;
    }

    tourPhaseRef.current = phase;
    tourNodeRef.current = null;

    const instance = driver({
      steps,
      animate: true,
      showProgress: true,
      overlayColor: '#111827',
      overlayOpacity: 0.58,
      smoothScroll: true,
      allowScroll: false,
      allowClose: true,
      allowKeyboardControl: true,
      stagePadding: 12,
      stageRadius: 18,
      popoverClass: 'app-tour-popover',
      nextBtnText: 'Tiếp',
      prevBtnText: 'Quay lại',
      doneBtnText: 'Xong',
      onHighlightStarted: (element) => {
        if (element instanceof HTMLElement) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      },
      onCloseClick: () => destroyTour(true),
      onDoneClick: () => destroyTour(true),
    });

    driverRef.current = instance;
    instance.drive();
  }, [buildIntroSteps, buildWorkflowSteps, destroyTour]);

  useEffect(() => {
    if (isLoading) return;
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(TOUR_SEEN_KEY) === '1') return;
    if (tourPhaseRef.current !== 'idle') return;

    const timer = window.setTimeout(() => {
      void (async () => {
        if (!selectedAutomationId) {
          await startTour('intro');
          return;
        }

        if (activeWorkflowNode) {
          await startNodeTour(activeWorkflowNode);
          return;
        }

        await startTour('workflow');
      })();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [activeWorkflowNode, isLoading, selectedAutomationId, startNodeTour, startTour]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (tourPhaseRef.current !== 'intro') return;
    if (!selectedAutomationId) return;
    if (!driverRef.current?.isActive?.()) return;

    const timer = window.setTimeout(() => {
      destroyTour(false);
      if (activeWorkflowNode) {
        void startNodeTour(activeWorkflowNode);
        return;
      }
      void startTour('workflow');
    }, 300);

    return () => window.clearTimeout(timer);
  }, [activeWorkflowNode, destroyTour, selectedAutomationId, startNodeTour, startTour]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (tourPhaseRef.current !== 'workflow') return;
    if (!activeWorkflowNode) return;
    if (!driverRef.current?.isActive?.()) return;
    if (tourNodeRef.current === activeWorkflowNode) return;

    const timer = window.setTimeout(() => {
      destroyTour(false);
      void startNodeTour(activeWorkflowNode);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [activeWorkflowNode, destroyTour, startNodeTour]);

  useEffect(() => {
    return () => {
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
    };
  }, []);

  return (
    <button
      type="button"
      id="btnAppTour"
      className="btn btn-secondary"
      onClick={() => void (async () => {
        if (!selectedAutomationId) {
          await startTour('intro');
          return;
        }
        if (activeWorkflowNode) {
          await startNodeTour(activeWorkflowNode);
          return;
        }
        await startTour('workflow');
      })()}
      style={{ border: '1px solid rgba(17, 24, 39, 0.12)', background: 'rgba(255,255,255,0.03)' }}
      title="Mở hướng dẫn"
    >
      <i className="fa-solid fa-circle-question" />
      Hướng dẫn
    </button>
  );
}
